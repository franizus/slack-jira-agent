import axios from 'axios';

jest.mock('axios');

const mockEnv = {
  JIRA_DOMAIN: 'kushki',
  JIRA_EMAIL: 'test@mail.com',
  JIRA_API_TOKEN: '1234',
} as const;
const mockEnvJira = {
  DEVELOPMENT_AGENT_URL: "agent-dev.kushki.com",
  DEVELOPMENT_AGENT_API_KEY: "dev-api",
} as const;

const testIssueData = {
  projectKey: 'TEST',
  summary: 'Test Issue',
  description: 'Test Description',
  issueType: 'Bug'
} as const;

interface JiraRequestBody {
  fields: {
    project: { key: string };
    summary: string;
    description: {
      type: 'doc';
      version: 1;
      content: Array<{
        type: string;
        content?: Array<{ type: string; text: string }>;
      }>;
    };
    issuetype: { name: string };
  };
}

describe('createJiraIssueTool', () => {
  const mockedAxios = jest.mocked(axios);
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = { ...originalEnv, ...mockEnv, ...mockEnvJira };
  });

  beforeEach(() => {
    jest.resetModules();
    mockedAxios.post.mockResolvedValue({
      data: { key: 'TEST-123' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { headers: {} }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it.each(Object.keys(mockEnv))('validates %s environment variable', (envVar) => {
    const env = { ...mockEnv };
    delete env[envVar as keyof typeof mockEnv];
    process.env = { ...originalEnv, ...env };

    expect(() => require('../tools'))
      .toThrow('Missing required Jira configuration');
  });

  it('sends correct Jira API request', async () => {
    const { createJiraIssueTool } = require('../tools');
    await createJiraIssueTool.invoke(testIssueData);

    const expectedUrl = `https://${mockEnv.JIRA_DOMAIN}.atlassian.net/rest/api/3/issue`;
    const [[url, requestBody, config]] = mockedAxios.post.mock.calls;

    expect(url).toBe(expectedUrl);
    expect(requestBody as JiraRequestBody).toMatchObject({
      fields: {
        project: { key: testIssueData.projectKey },
        summary: testIssueData.summary,
        issuetype: { name: testIssueData.issueType }
      }
    });
    expect(config?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': expect.stringContaining('Basic ')
    });
  });

  it('correctly converts markdown to Jira ADF', async () => {
    const { createJiraIssueTool } = require('../tools');
    const markdownDescription = '### Criterios de Aceptación\n' +
        '\n' +
        '| Dado que | Cuando | Entonces |\n' +
        '|---|---|---|\n' +
        '| es un nuevo producto | se cree la historia | se validará el funcionamiento correcto |';

    await createJiraIssueTool.invoke({
      ...testIssueData,
      description: markdownDescription
    });

    const [[, requestBody]] = mockedAxios.post.mock.calls;
    const typedBody = requestBody as JiraRequestBody;

    expect(typedBody.fields.description).toMatchObject({
      type: 'doc',
      version: 1,
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'table' })
      ])
    });
  });

  it('returns formatted success response', async () => {
    const { createJiraIssueTool } = require('../tools');
    const result = await createJiraIssueTool.invoke(testIssueData);

    expect(result).toBe(
      `Issue TEST-123 creado exitosamente. URL: https://${mockEnv.JIRA_DOMAIN}.atlassian.net/browse/TEST-123`
    );
  });

  it('handles Jira API errors properly', async () => {
    const { createJiraIssueTool } = require('../tools');
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: { errorMessages: ['Invalid project'] },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: {} }
      },
      config: { headers: {} },
      name: 'AxiosError',
      message: 'Request failed'
    });

    await expect(createJiraIssueTool.invoke(testIssueData))
      .rejects
      .toThrow('Error al crear el issue en Jira: Invalid project');
  });

  it('handles network errors', async () => {
    const { createJiraIssueTool } = require('../tools');
    const networkError = new Error('Network Error');
    mockedAxios.post.mockRejectedValueOnce(networkError);

    await expect(createJiraIssueTool.invoke(testIssueData))
      .rejects
      .toThrow('Network Error');
  });
});
