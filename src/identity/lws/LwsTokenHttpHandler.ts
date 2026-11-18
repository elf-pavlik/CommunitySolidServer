/* eslint-disable @typescript-eslint/naming-convention */
import { getLoggerFor } from 'global-logger-factory';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import type { StorageLocationStrategy } from '../../server/description/StorageLocationStrategy';
import type { HttpHandlerInput } from '../../server/HttpHandler';
import { HttpHandler } from '../../server/HttpHandler';
import type { HttpResponse } from '../../server/HttpResponse';
import type { ResourceSet } from '../../storage/ResourceSet';
import { APPLICATION_JSON, APPLICATION_X_WWW_FORM_URLENCODED } from '../../util/ContentTypes';
import { createErrorMessage } from '../../util/errors/ErrorUtil';
import { NotImplementedHttpError } from '../../util/errors/NotImplementedHttpError';
import { parseContentType } from '../../util/HeaderUtil';
import { joinUrl } from '../../util/PathUtil';
import { readableToString } from '../../util/StreamUtil';
import { verifyDpopProof } from './DpopUtil';
import type { LwsAccessClaim, LwsAccessTokenIssuer } from './LwsAccessTokenIssuer';
import type { SubjectTokenVerifier } from './SubjectTokenVerifier';

/**
 * The grant type of OAuth 2.0 Token Exchange.
 */
export const GRANT_TYPE_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

/**
 * An OAuth 2.0 error, as described in Section 5.2 of RFC 6749.
 */
class OAuthError extends Error {
  public readonly error: string;

  public constructor(error: string, description: string) {
    super(description);
    this.error = error;
  }
}

/**
 * Arguments for the {@link LwsTokenHttpHandler}.
 */
/**
 * The input of a storage-specific exchange access policy.
 *
 * The policy only runs when the verified subject token carries no ODRL access
 * claim. It decides whether this authorization server may mint a `scope` for
 * the exchange (for example `owner` or `admin` on a data storage).
 */
export interface LwsTokenExchangePolicyInput {
  /** The subject (`sub`) of the verified subject token. */
  subject: string;
  /** The client (`client_id`) of the verified subject token. */
  client: string;
  /** The issuer of the verified subject token. */
  issuer: string;
  /** The storage the access token is requested for (the `resource` parameter). */
  resource: string;
}

/**
 * Decides whether a claimless token exchange gets a storage `scope`.
 *
 * Implementations throw {@link LwsExchangeAccessDeniedError} when the exchange
 * has no authority at all; the handler turns that into `invalid_grant`.
 */
export abstract class LwsTokenExchangePolicy {
  public abstract determineScope(input: LwsTokenExchangePolicyInput): Promise<string[] | undefined>;
}

/**
 * A claimless exchange that the storage access policy does not allow.
 * Maps to the OAuth `invalid_grant` error, not a malformed request.
 */
export class LwsExchangeAccessDeniedError extends Error {
  public static isInstance(error: unknown): error is LwsExchangeAccessDeniedError {
    return error instanceof LwsExchangeAccessDeniedError;
  }
}

export interface LwsTokenHttpHandlerArgs {
  /**
   * Issues the access tokens.
   */
  issuer: LwsAccessTokenIssuer;
  /**
   * Validates the subject tokens. Usually a combination of one verifier per supported authentication suite.
   */
  verifier: SubjectTokenVerifier;
  /**
   * Used to verify that the requested resource is a storage on this server.
   */
  storageStrategy: StorageLocationStrategy;
  /**
   * Used to verify that the requested storage exists.
   */
  resourceSet: ResourceSet;
  /**
   * The path of the token endpoint, relative to the authorization server identifier.
   * Used to verify the `htu` claim of DPoP proofs. Defaults to `.well-known/lws/token`.
   */
  tokenPath?: string;
  /**
   * Optional policy that mints a storage `scope` for a claimless exchange and
   * rejects an exchange that has neither a claim nor an allowed scope.
   * Without a policy, a claimless exchange is issued without a scope (the
   * registry server relies on ACP for authorization).
   */
  accessPolicy?: LwsTokenExchangePolicy;
  /**
   * Whether a verified access claim is copied into the access token.
   * Defaults to true. The registry server sets this to false because ACP
   * authorizes registry resources and a claim is neither required nor used.
   */
  copyAccessClaim?: boolean;
}

/**
 * The token endpoint of the LWS authorization server.
 *
 * Supports the OAuth 2.0 Token Exchange grant type (RFC 8693) as described in LWS, §Token Exchange:
 * a client presents a subject token, such as an authentication credential,
 * and receives an access token for the storage identified by the `resource` parameter.
 *
 * Only storages hosted by this server are accepted as resource:
 * "The authorization server MUST reject any request in which the resource parameter identifies
 * an unknown or untrusted storage."
 *
 * Errors are returned as described in Section 5.2 of RFC 6749.
 *
 * In case the request contains a DPoP proof (RFC 9449), the proof is verified,
 * and the thumbprint of its key is passed to the verifier,
 * so sender-constrained subject tokens can only be exchanged by the client holding their key.
 * The issued access token is still a bearer token, as LWS requires.
 */
export class LwsTokenHttpHandler extends HttpHandler {
  protected readonly logger = getLoggerFor(this);

  private readonly issuer: LwsAccessTokenIssuer;
  private readonly verifier: SubjectTokenVerifier;
  private readonly storageStrategy: StorageLocationStrategy;
  private readonly resourceSet: ResourceSet;
  private readonly tokenEndpoint: string;
  private readonly accessPolicy?: LwsTokenExchangePolicy;
  private readonly copyAccessClaim: boolean;

  public constructor(args: LwsTokenHttpHandlerArgs) {
    super();
    this.issuer = args.issuer;
    this.verifier = args.verifier;
    this.storageStrategy = args.storageStrategy;
    this.resourceSet = args.resourceSet;
    this.tokenEndpoint = joinUrl(this.issuer.issuer, args.tokenPath ?? '.well-known/lws/token');
    this.accessPolicy = args.accessPolicy;
    this.copyAccessClaim = args.copyAccessClaim ?? true;
  }

  public async handle({ request, response }: HttpHandlerInput): Promise<void> {
    try {
      const contentType = request.headers['content-type'];
      if (!contentType || parseContentType(contentType).value !== APPLICATION_X_WWW_FORM_URLENCODED) {
        throw new OAuthError('invalid_request', `Token requests need to use ${APPLICATION_X_WWW_FORM_URLENCODED}.`);
      }
      const proofKeyThumbprint = await this.verifyProof(request);
      const params = new URLSearchParams(await readableToString(request));
      const body = await this.exchange(params, proofKeyThumbprint);
      this.writeJson(response, 200, body);
    } catch (error: unknown) {
      if (error instanceof OAuthError) {
        this.logger.warn(`Rejected token request: ${error.message}`);
        this.writeJson(response, 400, { error: error.error, error_description: error.message });
      } else {
        throw error;
      }
    }
  }

  /**
   * Validates the token request and issues an access token.
   */
  protected async exchange(params: URLSearchParams, proofKeyThumbprint?: string): Promise<Record<string, unknown>> {
    const grantType = this.getParameter(params, 'grant_type');
    if (grantType !== GRANT_TYPE_TOKEN_EXCHANGE) {
      throw new OAuthError('unsupported_grant_type', `Only the ${GRANT_TYPE_TOKEN_EXCHANGE} grant type is supported.`);
    }
    const resource = this.getParameter(params, 'resource');
    const token = this.getParameter(params, 'subject_token');
    const tokenType = this.getParameter(params, 'subject_token_type');
    await this.verifyStorage(resource);

    let subject: Awaited<ReturnType<SubjectTokenVerifier['handle']>>;
    try {
      subject = await this.verifier.handleSafe({
        token,
        tokenType,
        audience: this.issuer.issuer,
        proofKeyThumbprint,
        resource,
      });
    } catch (error: unknown) {
      if (NotImplementedHttpError.isInstance(error)) {
        throw new OAuthError('invalid_request', `Unsupported subject token: ${error.message}`);
      }
      throw new OAuthError('invalid_request', `Invalid subject token: ${createErrorMessage(error)}`);
    }

    let claim: LwsAccessClaim | undefined;
    if (subject.access !== undefined) {
      if (typeof subject.accessContext !== 'string') {
        throw new OAuthError('invalid_request', 'The access claim of the subject token needs a JSON-LD context.');
      }
      if (this.copyAccessClaim) {
        claim = {
          context: subject.accessContext,
          access: subject.access,
          ...subject.act === undefined ? {} : { act: subject.act },
        };
      }
    }

    let scope: string[] | undefined;
    if (claim === undefined && this.accessPolicy) {
      try {
        scope = await this.accessPolicy.determineScope({
          subject: subject.subject,
          client: subject.client,
          issuer: subject.issuer,
          resource,
        });
      } catch (error: unknown) {
        if (LwsExchangeAccessDeniedError.isInstance(error)) {
          throw new OAuthError('invalid_grant', error.message);
        }
        throw error;
      }
    }

    const accessToken = await this.issuer.issue(
      subject.subject,
      subject.client,
      resource,
      claim,
      scope,
    );
    this.logger.info(`Issued an access token for ${resource} to ${subject.subject} using client ${subject.client}`);
    return {
      access_token: accessToken,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: this.issuer.lifetime,
    };
  }

  /**
   * Verifies the DPoP proof of the request, if there is one, and returns the thumbprint of its key.
   */
  private async verifyProof(request: HttpHandlerInput['request']): Promise<string | undefined> {
    const proof = request.headers.dpop;
    if (proof === undefined) {
      return;
    }
    if (typeof proof !== 'string') {
      throw new OAuthError('invalid_dpop_proof', 'Only a single DPoP header is allowed.');
    }
    try {
      return await verifyDpopProof(proof, 'POST', this.tokenEndpoint);
    } catch (error: unknown) {
      throw new OAuthError('invalid_dpop_proof', createErrorMessage(error));
    }
  }

  /**
   * Returns the single value of a required parameter.
   */
  private getParameter(params: URLSearchParams, name: string): string {
    const values = params.getAll(name);
    if (values.length !== 1 || values[0].length === 0) {
      throw new OAuthError('invalid_request', `The ${name} parameter is required and must have a single value.`);
    }
    return values[0];
  }

  /**
   * Verifies the given URI identifies an existing storage on this server.
   */
  private async verifyStorage(resource: string): Promise<void> {
    const identifier: ResourceIdentifier = { path: resource };
    let valid = false;
    try {
      const storage = await this.storageStrategy.getStorageIdentifier(identifier);
      valid = storage.path === resource && await this.resourceSet.hasResource(storage);
    } catch {
      // Not a resource on this server
    }
    if (!valid) {
      throw new OAuthError('invalid_target', `${resource} is not a storage known to this authorization server.`);
    }
  }

  private writeJson(response: HttpResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, {
      'content-type': APPLICATION_JSON,
      'cache-control': 'no-store',
      pragma: 'no-cache',
    });
    response.end(JSON.stringify(body));
  }
}
