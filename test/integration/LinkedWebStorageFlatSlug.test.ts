import { randomUUID } from 'node:crypto';
import type { App } from '../../src/init/App';
import type { ResourceStore } from '../../src/storage/ResourceStore';
import { AclHelper } from '../util/AclHelper';
import { getPort } from '../util/Util';
import { getDefaultVariables, getPresetConfigPath, getTestConfigPath, instantiateFromConfig } from './Config';

const port = getPort('LinkedWebStorageFlatSlug');
const baseUrl = `http://localhost:${port}/`;

const LWS_NAMESPACE = 'https://www.w3.org/ns/lws#';
const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function uuid(): string {
  return randomUUID();
}

describe('A flat Linked Web Storage server that honors UUID slugs', (): void => {
  let app: App;
  let store: ResourceStore;

  beforeAll(async(): Promise<void> => {
    const instances = await instantiateFromConfig(
      'urn:solid-server:test:Instances',
      [
        getTestConfigPath('lws-flat-slug-server.json'),
        ...[
          'ldp/authentication/lws.json',
          'ldp/handler/lws.json',
          'ldp/authorization/webacl.json',
          'ldp/metadata-writer/lws.json',
          'util/auxiliary/acl.json',
          'util/representation-conversion/lws.json',
        ].map(getPresetConfigPath),
      ],
      getDefaultVariables(port, baseUrl),
    ) as Record<string, any>;
    ({ app, store } = instances);
    await app.start();
    await new AclHelper(store).setSimpleAcl(baseUrl, {
      permissions: [ 'read', 'write', 'append', 'control' ],
      agentClass: 'agent',
      accessTo: true,
      default: true,
    });
  });

  afterAll(async(): Promise<void> => {
    await app.stop();
  });

  it('honors UUID slugs and rejects duplicates and invalid slugs.', async(): Promise<void> => {
    const containerSlug = uuid();
    const nestedSlug = uuid();
    const resourceSlug = uuid();

    // A UUID slug is honored for a container.
    let response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        link: `<${LWS_NAMESPACE}Container>; rel="type"`,
        slug: containerSlug,
      },
    });
    expect(response.status).toBe(201);
    const container = response.headers.get('location')!;
    expect(container).toBe(`${baseUrl}${containerSlug}`);

    // A UUID slug is honored for a data resource.
    response = await fetch(container, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', slug: resourceSlug },
      body: 'slug content',
    });
    expect(response.status).toBe(201);
    const resource = response.headers.get('location')!;
    expect(resource).toBe(`${baseUrl}${resourceSlug}`);
    await expect(fetch(resource).then(async(response): Promise<string> => response.text()))
      .resolves.toBe('slug content');

    // A duplicate slug conflicts, rather than falling back to a random UUID.
    response = await fetch(container, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', slug: resourceSlug },
      body: 'other content',
    });
    expect(response.status).toBe(409);
    await expect(fetch(resource).then(async(response): Promise<string> => response.text()))
      .resolves.toBe('slug content');

    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        link: `<${LWS_NAMESPACE}Container>; rel="type"`,
        slug: containerSlug,
      },
    });
    expect(response.status).toBe(409);

    // Slugs that are not UUIDs are rejected.
    response = await fetch(container, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', slug: 'not-a-uuid' },
      body: 'invalid',
    });
    expect(response.status).toBe(400);

    // Identifiers never have a trailing slash, also in slugs.
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        link: `<${LWS_NAMESPACE}Container>; rel="type"`,
        slug: `${uuid()}/`,
      },
    });
    expect(response.status).toBe(400);

    // Without a slug a random UUID is allocated.
    response = await fetch(container, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'random',
    });
    expect(response.status).toBe(201);
    const random = response.headers.get('location')!;
    expect(UUID_PATH.test(new URL(random).pathname.slice(1))).toBe(true);

    // UUIDs are unique across the whole flat storage, also for nested containers.
    response = await fetch(container, {
      method: 'POST',
      headers: {
        link: `<${LWS_NAMESPACE}Container>; rel="type"`,
        slug: nestedSlug,
      },
    });
    expect(response.status).toBe(201);
    const nested = response.headers.get('location')!;
    expect(nested).toBe(`${baseUrl}${nestedSlug}`);

    response = await fetch(nested, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', slug: resourceSlug },
      body: 'duplicate in nested container',
    });
    expect(response.status).toBe(409);

    // Clean up bottom-up.
    for (const target of [ random, resource, nested, container ]) {
      expect((await fetch(target, { method: 'DELETE' })).status).toBe(204);
    }
  });
});
