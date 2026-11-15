import type { PolicyEngine } from '@solidlab/policy-engine';
import { PERMISSIONS } from '@solidlab/policy-engine';
import type { Credentials } from '../../../src/authentication/Credentials';
import type { AccessMap } from '../../../src/authorization/permissions/Permissions';
import { PolicyEngineReader } from '../../../src/authorization/PolicyEngineReader';
import { IdentifierSetMultiMap } from '../../../src/util/map/IdentifierMap';

describe('A PolicyEngineReader', (): void => {
  const identifier = { path: 'http://example.com/foo' };
  const identifier2 = { path: 'http://example.com/bar' };
  const credentials: Credentials = {};
  let requestedModes: AccessMap;
  let engine: jest.Mocked<PolicyEngine>;
  let reader: PolicyEngineReader;

  beforeEach(async(): Promise<void> => {
    requestedModes = new IdentifierSetMultiMap();

    engine = {
      getPermissions: jest.fn(),
      getPermissionsWithReport: jest.fn(),
    };

    reader = new PolicyEngineReader(engine);
  });

  it('forwards the LWS access claim fields to the policy engine.', async(): Promise<void> => {
    requestedModes.add(identifier, PERMISSIONS.Read);
    engine.getPermissions.mockResolvedValue({});
    const access = [{ id: 'urn:policy' }];
    const result = await reader.handle({
      credentials: {
        agent: { webId: 'https://id/alice' },
        client: { clientId: 'https://app.example/id' },
        issuer: { url: 'https://data.example/' },
        access,
        accessContext: 'https://www.w3.org/ns/solid/interop-context/v1/odrl-id-jag-context',
        storage: { path: 'https://data.example/' },
      },
      requestedModes,
    });

    expect(result.size).toBe(1);
    expect(engine.getPermissions).toHaveBeenLastCalledWith(
      identifier.path,
      {
        agent: 'https://id/alice',
        client: 'https://app.example/id',
        issuer: 'https://data.example/',
        access,
        accessContext: 'https://www.w3.org/ns/solid/interop-context/v1/odrl-id-jag-context',
        storage: 'https://data.example/',
      },
      [ PERMISSIONS.Read ],
    );
  });

  it('converts the returned permissions to access modes.', async(): Promise<void> => {
    requestedModes.add(identifier, PERMISSIONS.Modify);
    requestedModes.add(identifier2, PERMISSIONS.Read);
    engine.getPermissions.mockResolvedValue({
      [PERMISSIONS.Modify]: true,
      [PERMISSIONS.Create]: false,
    });
    const result = await reader.handle({ credentials, requestedModes });
    expect(result.size).toBe(2);
    expect(result.get(identifier)).toEqual({
      [PERMISSIONS.Modify]: true,
      [PERMISSIONS.Create]: false,
    });
    expect(result.get(identifier2)).toEqual({
      [PERMISSIONS.Modify]: true,
      [PERMISSIONS.Create]: false,
    });
  });
});
