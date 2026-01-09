interface TemplateData {
  detail: string;
  name: string;
  baseUrl: string;
}

function mockTemplate(data: TemplateData): string {
  return `Hello ${data.name}, your detail is ${data.detail}`;
}

export default mockTemplate;
