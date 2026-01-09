# Tagged Template Literal Engine

The TaggedTemplateLiteralEngine is a new template engine that uses TypeScript/JavaScript functions with tagged template literals instead of traditional template syntax.

## Benefits over Handlebars

- **Full TypeScript support**: Type safety and IDE autocomplete
- **No runtime template compilation**: Templates are compiled at build time
- **Better developer experience**: Modern JavaScript features
- **Easier debugging**: Standard JavaScript functions are easier to debug

## Usage

### Template Structure

Template files should:
1. Export a default function
2. Accept a data object with properties matching your needs
3. Return a string using tagged template literals

### Example Template

```typescript
interface TemplateData {
  webId: string;
  name?: string;
  email?: string;
  baseUrl?: string;
}

const template = ({ webId }: TemplateData): string => `
# Resource Access Control
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

<#authorization>
    a acl:Authorization;
    acl:agent <${webId}>;
    acl:accessTo <./>;
    acl:mode acl:Read, acl:Write, acl:Control.
`;

export default template;
```

### Available Data

When rendering templates, the following data is available:

- All properties from the `contents` object passed to the template engine
- `baseUrl`: The base URL of the server (automatically added)

For pod templates, this includes:
- `webId`: The WebID of the pod owner
- `name`: The owner's name (optional)
- `email`: The owner's email (optional)
- `oidcIssuer`: The OIDC issuer (optional)

### File Extensions

The TaggedTemplateLiteralEngine supports the following file extensions:
- `.ts` - TypeScript template files (recommended)
- `.js` - JavaScript template files

### Configuration

The TaggedTemplateLiteralEngine is automatically registered in the template engine waterfall (see `config/app/main/general/templates.json`) and will be used for `.ts` and `.js` template files.

## Migration from Handlebars

To migrate a Handlebars template to tagged template literals:

**Handlebars (.hbs)**:
```handlebars
Hello {{name}}, your webId is {{webId}}.
```

**Tagged Template Literal (.ts)**:
```typescript
const template = ({ name, webId }): string => `
Hello ${name}, your webId is ${webId}.
`;

export default template;
```

### Key Changes

1. Remove `{{ }}` syntax and use `${ }` for interpolation
2. Wrap the template in a function
3. Export the function as default
4. Use TypeScript interfaces for type safety (optional but recommended)

## Example

See `templates/pod/acp/.acr.ts` for a complete example of an ACP template using tagged template literals.
