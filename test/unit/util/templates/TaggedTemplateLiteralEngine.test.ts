import { join } from 'node:path';

import { NotImplementedHttpError } from '../../../../src';
import { TaggedTemplateLiteralEngine } from '../../../../src/util/templates/TaggedTemplateLiteralEngine';

jest.mock('../../../../src/util/templates/TemplateUtil', (): any => ({
  getTemplateFilePath: jest.fn((template): string => template),
}));

describe('A TaggedTemplateLiteralEngine', (): void => {
  const contents = { detail: 'test', name: 'Alice' };
  let templateEngine: TaggedTemplateLiteralEngine;

  beforeEach((): void => {
    templateEngine = new TaggedTemplateLiteralEngine('http://localhost:3000/');
  });

  it('uses the passed template.', async(): Promise<void> => {
    const mockPath = join(__dirname, 'mocks', 'mockTemplate.ts');

    const result = await templateEngine.handleSafe({ contents, template: mockPath });
    expect(result).toBe('Hello Alice, your detail is test');
  });

  it('throws an exception for unsupported template files.', async(): Promise<void> => {
    await expect(templateEngine.handleSafe({ contents, template: 'someTemplate.txt' }))
      .rejects.toThrow(NotImplementedHttpError);
  });

  it('throws an exception if no template was passed.', async(): Promise<void> => {
    await expect(templateEngine.handleSafe({ contents }))
      .rejects.toThrow(Error);
  });

  it('includes baseUrl in template data.', async(): Promise<void> => {
    const contentsWithBaseUrl = { detail: 'test', name: 'Alice', baseUrl: 'http://localhost:3000/' };
    const mockPath = join(__dirname, 'mocks', 'mockTemplate.ts');

    const result = await templateEngine.handleSafe({ contents: contentsWithBaseUrl, template: mockPath });
    expect(result).toBe('Hello Alice, your detail is test');
  });
});
