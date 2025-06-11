import {marked} from "marked";
import axios from "axios";

// Jira configuration from environment variables
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error("Missing required Jira configuration in environment variables");
}

/**
 * Converts Markdown to Atlassian Document Format (ADF).
 * @param markdown - The Markdown string to convert.
 * @returns ADF-compliant JSON object.
 */
function markdownToADF(markdown: string): any {
    const tokens = marked.lexer(markdown);

    const adfContent = tokens.map((token) => {
        if (token.type === "paragraph") {
            return {
                type: "paragraph",
                content: [{type: "text", text: token.text}],
            };
        }

        if (token.type === "heading") {
            return {
                type: "heading",
                attrs: {level: token.depth},
                content: [{type: "text", text: token.text}],
            };
        }

        if (token.type === "table") {
            const tableContent = token.rows.map((row: any[]) => ({
                type: "tableRow",
                content: row.map((cell) => ({
                    type: "tableCell",
                    content: [{
                        type: "paragraph",
                        content: [{type: "text", text: cell.text || ""}],
                    }],
                })),
            }));

            if (token.header) {
                tableContent.unshift({
                    type: "tableRow",
                    content: token.header.map((cell: { text: any; }) => ({
                        type: "tableHeader",
                        content: [{
                            type: "paragraph",
                            content: [{
                                type: "text",
                                text: cell.text || "",
                                marks: [{type: "strong"}],
                            }],
                        }],
                    })),
                });
            }

            return {type: "table", content: tableContent};
        }

        return null; // Skip unsupported token types
    }).filter(Boolean);

    return {type: "doc", version: 1, content: adfContent};
}

/**
 * Retrieves user ID of the assignee and search on the jira users API
 * @param assigneeEmailAddress - The email address of the assignee.
 * @returns Jira user ID
 */
async function getAssigneeUserID(assigneeEmailAddress: string): Promise<string> {
    const url = `https://${JIRA_DOMAIN}.atlassian.net/rest/api/3/user/search?query=${encodeURIComponent(assigneeEmailAddress)}`;
    const headers = {
        Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
    };

    const {data} = await axios.get(url, {headers});

    if (!data?.length) {
        console.error('Response:', data);
        throw new Error(`No se encontró un usuario con el email: ${assigneeEmailAddress}`);
    }

    return data[0].accountId;
}

/**
 * Interface for sendIssue method parameters
 */
export interface SendIssueInput {
    /** The key of the Jira project */
    projectKey: string;
    /** The summary/title of the issue */
    summary: string;
    /** The description of the issue in Markdown format */
    description: string;
    /** The type of the issue (default is "Task") */
    issueType?: string;
    /** Email address of the assignee */
    assigneeEmailAddress: string;
    /** UAT deployment date */
    uatDeployDate?: string;
    /** Production deployment date */
    prodDeployDate?: string;
    /** Issue priority (default is "Medium") */
    priority?: string;
    /** Methodology array */
    methodology?: string[];
    /** Parent issue key for sub-tasks */
    parentIssueKey?: string;
}

/**
 * Sends an issue to Jira with the provided details.
 * @param input - The issue details
 **/
export async function sendIssue(input: SendIssueInput) {
    const {
        projectKey,
        summary,
        description,
        issueType = "Task",
        assigneeEmailAddress,
        uatDeployDate,
        prodDeployDate,
        priority = "Medium",
        methodology = [],
        parentIssueKey,
    } = input;

    try {

        const adfDescription = markdownToADF(description);
        const assigneeId = await getAssigneeUserID(assigneeEmailAddress);

        const requestBody = {
            fields: {
                project: {key: projectKey},
                summary,
                description: adfDescription,
                issuetype: {name: issueType},
                assignee: {id: assigneeId},
                ...(uatDeployDate && {customfield_11942: uatDeployDate}),
                ...(prodDeployDate && {customfield_11896: prodDeployDate}),
                ...(priority && {priority: {name: priority}}),
                ...(methodology?.length && {
                    customfield_12155: methodology.map((method) => ({value: method})),
                }),
                ...(parentIssueKey && {parent: {key: parentIssueKey}}),
            },
        };

        console.log("Request Body:", JSON.stringify(requestBody, null, 2));

        const response = await axios.post(
            `https://${JIRA_DOMAIN}.atlassian.net/rest/api/3/issue`,
            requestBody,
            {
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        `${JIRA_EMAIL}:${JIRA_API_TOKEN}`
                    ).toString("base64")}`,
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
            }
        );

        return {
            issueKey: response.data.key,
            issueUrl: `https://${JIRA_DOMAIN}.atlassian.net/browse/${response.data.key}`,
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const errorMessage =
                error.response?.data?.errorMessages?.join(", ") || error.message;
            console.log(`Error al crear el issue en Jira: ${errorMessage}`);
            throw new Error(`Error al crear el issue en Jira: ${errorMessage}`);
        }
        throw error;
    }
}