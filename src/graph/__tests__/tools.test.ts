import { createJiraIssueTool } from '../tools';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('createJiraIssueTool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };

    // Set required environment variables
    process.env.JIRA_DOMAIN = "kushki";
    process.env.JIRA_EMAIL = "test@mail.com";
    process.env.JIRA_API_TOKEN = "1234";

    // Reset mock before each test
    jest.clearAllMocks();

    // Setup default mock response
    mockedAxios.post.mockResolvedValue({
      data: { key: 'TEST-123' }
    });
  });

  afterEach(() => {
    // Restore process.env after each test
    process.env = originalEnv;
    jest.resetModules();
  });

  it('should throw error when JIRA_DOMAIN is missing', async () => {
    delete process.env.JIRA_DOMAIN;
    jest.isolateModules(async () => {
      expect(() => require('../tools')).toThrow('Missing required Jira configuration in environment variables');
    });
  });

  it('should throw error when JIRA_EMAIL is missing', async () => {
    delete process.env.JIRA_EMAIL;
    jest.isolateModules(async () => {
      expect(() => require('../tools')).toThrow('Missing required Jira configuration in environment variables');
    });
  });

  it('should throw error when JIRA_API_TOKEN is missing', async () => {
    delete process.env.JIRA_API_TOKEN;
    jest.isolateModules(async () => {
      expect(() => require('../tools')).toThrow('Missing required Jira configuration in environment variables');
    });
  });

  // For the remaining tests, we'll import the tool here since we know the env vars are set
  let createJiraIssueTool: any;

  beforeEach(async () => {
    jest.isolateModules(async () => {
      const tools = require('../tools');
      createJiraIssueTool = tools.createJiraIssueTool;
    });
  });
});
