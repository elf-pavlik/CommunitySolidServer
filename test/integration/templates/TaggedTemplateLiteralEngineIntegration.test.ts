import { join } from 'node:path';

import { TaggedTemplateLiteralEngine } from '../../../src/util/templates/TaggedTemplateLiteralEngine';

describe('A TaggedTemplateLiteralEngine with ACR template', (): void => {
  let templateEngine: TaggedTemplateLiteralEngine;

  beforeEach((): void => {
    templateEngine = new TaggedTemplateLiteralEngine('http://localhost:3000/');
  });

  it('renders the .acr.ts template with webId.', async(): Promise<void> => {
    const webId = 'http://example.com/profile/card#me';
    const contents = { webId };
    const templatePath = join(process.cwd(), 'templates', 'pod', 'acp', '.acr.ts');

    const result = await templateEngine.handleSafe({ contents, template: templatePath });

    expect(result).toContain(webId);
    expect(result).toContain('# Root ACR for the agent account');
    expect(result).toContain('acp:agent <http://example.com/profile/card#me>');
  });

  it('renders with additional pod settings.', async(): Promise<void> => {
    const webId = 'http://example.com/profile/card#me';
    const name = 'Alice';
    const email = 'alice@example.com';
    const contents = { webId, name, email };
    const templatePath = join(process.cwd(), 'templates', 'pod', 'acp', '.acr.ts');

    const result = await templateEngine.handleSafe({ contents, template: templatePath });

    expect(result).toContain(webId);
    expect(result).toContain('# Root ACR for the agent account');
  });
});
