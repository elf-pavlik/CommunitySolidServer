import type { RepresentationMetadata } from '../http/representation/RepresentationMetadata';
import type { ResourceIdentifier } from '../http/representation/ResourceIdentifier';
import { BadRequestHttpError } from '../util/errors/BadRequestHttpError';
import { ConflictHttpError } from '../util/errors/ConflictHttpError';
import { ensureTrailingSlash, trimTrailingSlashes } from '../util/PathUtil';
import { SOLID_HTTP } from '../util/Vocabularies';
import { FlatDataAccessorBasedStore } from './FlatDataAccessorBasedStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A {@link FlatDataAccessorBasedStore} that honors a UUID `Slug` header.
 *
 * Without a slug, a random UUID is allocated under the storage root.
 * With a slug, the slug has to be a UUID and is used directly as the identifier under the storage root.
 * Identifiers never end in a slash, not even for containers.
 *
 * If the requested UUID is already in use, a 409 Conflict is returned instead of generating a different identifier.
 */
export class HonorUuidSlugDataAccessorBasedStore extends FlatDataAccessorBasedStore {
  protected override async createSafeUri(container: ResourceIdentifier, metadata: RepresentationMetadata):
  Promise<ResourceIdentifier> {
    const slug = metadata.get(SOLID_HTTP.terms.slug)?.value;
    if (!slug) {
      return super.createSafeUri(container, metadata);
    }

    if (!UUID.test(slug)) {
      throw new BadRequestHttpError('Slug headers need to be UUIDs.');
    }
    metadata.removeAll(SOLID_HTTP.terms.slug);

    const storage = await this.storageStrategy.getStorageIdentifier(container);
    const newID = this.createURI(storage, false, slug);

    // The identifier is fixed by the slug, so an existing resource is a conflict.
    const withSlash = { path: ensureTrailingSlash(newID.path) };
    const withoutSlash = { path: trimTrailingSlashes(newID.path) };
    if (await this.hasResource(withSlash) || await this.hasResource(withoutSlash)) {
      throw new ConflictHttpError(`A resource with identifier ${newID.path} already exists.`);
    }

    return newID;
  }
}
