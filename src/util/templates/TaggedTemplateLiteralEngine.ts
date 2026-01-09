import { ExtensionBasedTemplateEngine } from './ExtensionBasedTemplateEngine';
import type { TemplateEngineInput } from './TemplateEngine';
import { getTemplateFilePath } from './TemplateUtil';
import Dict = NodeJS.Dict;

/**
 * Template function type that takes data and returns a string.
 */
export type TemplateFunction<T extends Dict<unknown>> = (data: T & { baseUrl: string }) => string;

/**
 * Fills in tagged template literal templates.
 * Template files should export a default function that takes data and returns a string.
 */
export class TaggedTemplateLiteralEngine<T extends Dict<unknown> = Dict<unknown>>
  extends ExtensionBasedTemplateEngine<T> {
  private readonly baseUrl: string;

  /**
   * @param baseUrl - Base URL of the server.
   * @param supportedExtensions - The extensions that are supported by this template engine (defaults to 'ts', 'js').
   */
  public constructor(baseUrl: string, supportedExtensions = [ 'ts', 'js' ]) {
    super(supportedExtensions);
    this.baseUrl = baseUrl;
  }

  public async handle({ contents, template }: TemplateEngineInput<T>): Promise<string> {
    const templatePath = getTemplateFilePath(template);
    if (!templatePath) {
      throw new Error('Template file path is required for TaggedTemplateLiteralEngine');
    }

    const templateModule = await this.importTemplate(templatePath);
    const templateFunction: TemplateFunction<T> = templateModule.default;

    return templateFunction({ ...contents, baseUrl: this.baseUrl });
  }

  /**
   * Dynamically imports the template module.
   */
  private async importTemplate(templatePath: string): Promise<{ default: TemplateFunction<T> }> {
    try {
      const module = await import(templatePath) as { default?: unknown };
      if (typeof module.default !== 'function') {
        throw new TypeError(`Template at ${templatePath} must export a default function`);
      }
      return module as { default: TemplateFunction<T> };
    } catch (error: unknown) {
      throw new TypeError(`Failed to load template at ${templatePath}: ${(error as Error).message}`);
    }
  }
}
