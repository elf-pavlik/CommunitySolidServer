import type { App } from '../../src/init/App';
import { BasicRepresentation } from '../../src/http/representation/BasicRepresentation';
import type { ResourceStore } from '../../src/storage/ResourceStore';
import { INTERNAL_QUADS } from '../../src/util/ContentTypes';
import { readableToQuads } from '../../src/util/StreamUtil';
import { LWS } from '../../src/util/Vocabularies';
import { AclHelper } from '../util/AclHelper';
import { getPort } from '../util/Util';
import { getDefaultVariables, getPresetConfigPath, getTestConfigPath, instantiateFromConfig } from './Config';

const LWS_NAMESPACE = 'https://www.w3.org/ns/lws#';
const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type RequestFn = (identifier: string, init?: RequestInit) => Promise<Response>;

function getLinks(response: Response): string[] {
  return (response.headers.get('link') ?? '').split(/,\s*(?=<)/u);
}

async function createContainer(request: RequestFn, parent: string, slug?: string): Promise<Response> {
  const headers: Record<string, string> = { link: `<${LWS_NAMESPACE}Container>; rel="type"` };
  if (slug) {
    headers.slug = slug;
  }
  return request(parent, {
    method: 'POST',
    headers,
  });
}

async function createDataResource(request: RequestFn, container: string, content: string, slug?: string):
Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'text/plain' };
  if (slug) {
    headers.slug = slug;
  }
  return request(container, {
    method: 'POST',
    headers,
    body: content,
  });
}

interface Level {
  container: string;
  resource?: string;
}

interface FlatConfiguration {
  name: string;
  config: string;
  port: number;
  storageRoot: string;
  forwarded?: string;
}

const suffixBaseUrl = `http://localhost:${getPort('LinkedWebStorageFlat')}/`;
const subdomainPort = getPort('LinkedWebStorageFlatSubdomain');
const subdomainHost = `alice.localhost:${subdomainPort}`;

const configurations: FlatConfiguration[] = [
  {
    name: 'suffix storage roots',
    config: 'lws-flat-server.json',
    port: getPort('LinkedWebStorageFlat'),
    storageRoot: suffixBaseUrl,
  },
  {
    name: 'subdomain storage roots',
    config: 'lws-flat-subdomain-server.json',
    port: subdomainPort,
    storageRoot: `http://${subdomainHost}/`,
    forwarded: `host=${subdomainHost}`,
  },
];

describe.each(configurations)('A flat Linked Web Storage server with $name', (configuration): void => {
  let app: App;
  let store: ResourceStore;

  const fetchBase = `http://localhost:${configuration.port}/`;

  /**
   * Sends a request to the local test server, using the forwarded host for subdomain configurations.
   */
  async function request(identifier: string, init: RequestInit = {}): Promise<Response> {
    const url = identifier.startsWith(configuration.storageRoot) ?
      `${fetchBase}${identifier.slice(configuration.storageRoot.length)}` :
      identifier;
    const headers = new Headers(init.headers);
    if (configuration.forwarded) {
      headers.set('forwarded', configuration.forwarded);
    }
    return fetch(url, { ...init, headers });
  }

  beforeAll(async(): Promise<void> => {
    const instances = await instantiateFromConfig(
      'urn:solid-server:test:Instances',
      [
        getTestConfigPath(configuration.config),
        ...[
          'ldp/authentication/lws.json',
          'ldp/handler/lws.json',
          'ldp/authorization/webacl.json',
          'ldp/metadata-writer/lws.json',
          'util/auxiliary/acl.json',
          'util/representation-conversion/lws.json',
        ].map(getPresetConfigPath),
      ],
      getDefaultVariables(configuration.port, fetchBase),
    ) as Record<string, any>;
    ({ app, store } = instances);
    await app.start();

    // Subdomain configurations only have the storage root after a pod is created.
    if (configuration.forwarded) {
      const storageRoot = { path: configuration.storageRoot };
      await store.setRepresentation(storageRoot, new BasicRepresentation([], storageRoot));
    }

    await new AclHelper(store).setSimpleAcl(configuration.storageRoot, {
      permissions: [ 'read', 'write', 'append', 'control' ],
      agentClass: 'agent',
      accessTo: true,
      default: true,
    });
  });

  afterAll(async(): Promise<void> => {
    await app.stop();
  });

  it('allocates UUIDs under the storage root using lws:contains metadata.', async(): Promise<void> => {
    const levels: Level[] = [];
    let parent = configuration.storageRoot;

    // Create three nested containers. Every container gets a UUID directly under the storage root.
    for (let depth = 0; depth < 3; depth++) {
      const response = await createContainer(request, parent, depth === 0 ? 'ignored-slug' : undefined);
      expect(response.status).toBe(201);
      const location = response.headers.get('location')!;
      const path = new URL(location).pathname;
      expect(path.endsWith('/')).toBe(false);
      expect(UUID_PATH.test(path.slice(1))).toBe(true);
      expect(location.startsWith(configuration.storageRoot)).toBe(true);
      expect(getLinks(response)).toContain(`<${parent}>; rel="up"`);
      levels.push({ container: location });
      parent = location;
    }

    // Add a data resource to every level.
    for (const [ index, level ] of levels.entries()) {
      const response = await createDataResource(
        request,
        level.container,
        `content at level ${index}`,
        index === 0 ? 'ignored-data-slug' : undefined,
      );
      expect(response.status).toBe(201);
      const location = response.headers.get('location')!;
      const path = new URL(location).pathname;
      expect(path.endsWith('/')).toBe(false);
      expect(UUID_PATH.test(path.slice(1))).toBe(true);
      expect(location.startsWith(configuration.storageRoot)).toBe(true);
      expect(getLinks(response)).toContain(`<${level.container}>; rel="up"`);
      level.resource = location;
    }

    // The stored containment metadata follows the logical hierarchy, not the flat URI space.
    const first = levels[0].container;
    const second = levels[1].container;
    const representation = await store.getRepresentation({ path: first }, { type: { [INTERNAL_QUADS]: 1 }});
    const quads = await readableToQuads(representation.data);
    const contained = quads.getObjects(first, LWS.terms.contains, null).map((term): string => term.value);
    expect(contained).toEqual(expect.arrayContaining([ second, levels[0].resource! ]));
    expect(contained).not.toContain(levels[2].container);

    // The container listing uses the metadata containment as well.
    let response = await request(first, { headers: { accept: 'application/lws+json' }});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { id: string }): string => item.id))
      .toEqual(expect.arrayContaining([ second, levels[0].resource! ]));
    expect(body.items.map((item: { id: string }): string => item.id))
      .not.toContain(levels[2].container);

    // Replace two data resources with PUT.
    for (const level of [ levels[0], levels[1] ]) {
      response = await request(level.resource!, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: `replaced ${level.resource}`,
      });
      expect(response.status).toBe(204);
      response = await request(level.resource!);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(`replaced ${level.resource}`);
    }

    // Delete the third data resource.
    response = await request(levels[2].resource!, { method: 'DELETE' });
    expect(response.status).toBe(204);
    response = await request(levels[2].resource!);
    expect(response.status).toBe(404);

    // A non-empty container can not be deleted.
    response = await request(levels[0].container, { method: 'DELETE' });
    expect(response.status).toBe(409);

    // Delete the remaining resources, then the containers bottom-up.
    for (const level of [ levels[0], levels[1] ]) {
      response = await request(level.resource!, { method: 'DELETE' });
      expect(response.status).toBe(204);
    }
    for (const level of [ ...levels ].reverse()) {
      response = await request(level.container, { method: 'DELETE' });
      expect(response.status).toBe(204);
      response = await request(level.container);
      expect(response.status).toBe(404);
    }

    // The containment metadata of the storage root no longer references the deleted hierarchy.
    const rootRepresentation = await store.getRepresentation(
      { path: configuration.storageRoot },
      { type: { [INTERNAL_QUADS]: 1 }},
    );
    const rootQuads = await readableToQuads(rootRepresentation.data);
    const rootContained = rootQuads.getObjects(configuration.storageRoot, LWS.terms.contains, null)
      .map((term): string => term.value);
    expect(rootContained).not.toContain(first);
  });
});
