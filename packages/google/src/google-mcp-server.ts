#!/usr/bin/env node

/**
 * Google MCP Server — Gmail + Calendar + Drive access via `gog` CLI.
 * Agents can search/read/manage email, send/reply to email, manage filters,
 * apply labels, and manage calendar events and shared Drive files.
 *
 * Requires `gog` CLI to be installed and authenticated.
 *
 * Env vars:
 *   GOG_ACCOUNTS — CSV of Google account emails. First entry is the implicit default.
 *                  When more than one is listed, every tool surfaces an `account` enum parameter.
 *   GOG_ACCOUNT  — Legacy single-account fallback when GOG_ACCOUNTS is unset.
 *   GOG_CLIENT   — OAuth client name (optional, uses gog default if unset)
 *   GOG_PATH     — path to gog binary (optional, auto-detected if unset)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const ACCOUNTS = (process.env.GOG_ACCOUNTS ?? process.env.GOG_ACCOUNT ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_ACCOUNT = ACCOUNTS[0] ?? "";
const MULTI = ACCOUNTS.length > 1;
const CLIENT = process.env.GOG_CLIENT ?? "";
const GOG =
  process.env.GOG_PATH ??
  (() => {
    try {
      return execFileSync("which", ["gog"], { encoding: "utf-8" }).trim();
    } catch {
      return "gog";
    }
  })();

type AccountField = { account?: z.ZodType<string | undefined> };
const accountField: AccountField = MULTI
  ? {
      account: z
        .enum(ACCOUNTS as [string, ...string[]])
        .optional()
        .describe(
          `Which Google account to use. Defaults to ${DEFAULT_ACCOUNT}. Available: ${ACCOUNTS.join(", ")}`,
        ),
    }
  : {};

function gog(account: string, args: string[]): string {
  const fullArgs = [
    ...args,
    ...(account ? ["-a", account] : []),
    ...(CLIENT ? ["--client", CLIENT] : []),
    "--json",
    "--results-only",
    "--no-input",
  ];
  return execFileSync(GOG, fullArgs, { encoding: "utf-8", timeout: 30_000 }).trim();
}

function gogPlain(account: string, args: string[]): string {
  const fullArgs = [
    ...args,
    ...(account ? ["-a", account] : []),
    ...(CLIENT ? ["--client", CLIENT] : []),
    "--plain",
    "--no-input",
  ];
  return execFileSync(GOG, fullArgs, { encoding: "utf-8", timeout: 30_000 }).trim();
}

function currentAccount(account: string | undefined): string {
  return account ?? DEFAULT_ACCOUNT;
}

function toolError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function addOptional(args: string[], flag: string, value: string | undefined): void {
  if (value?.trim()) args.push(flag, value);
}

function addBoolean(args: string[], flag: string, value: boolean | undefined): void {
  if (value) args.push(flag);
}

function addRepeated(args: string[], flag: string, values: string[] | undefined): void {
  for (const value of values ?? []) {
    if (value.trim()) args.push(flag, value);
  }
}

function confirmDangerous(confirmed: boolean | undefined, action: string) {
  if (confirmed === true) return null;
  return toolError(`Refusing to ${action}. Pass confirm: true after verifying the target.`);
}

const server = new McpServer({
  name: "hive-google",
  version: "0.2.0",
});

// ── Gmail ───────────────────────────────────────────────────────────────

server.registerTool(
  "gmail_search",
  {
    title: "Search Email",
    description:
      "Search Gmail using Gmail query syntax (e.g. 'from:someone@example.com', 'is:unread newer_than:1d', 'subject:invoice'). Returns thread summaries.",
    inputSchema: {
      query: z.string().describe("Gmail search query"),
      max: z.number().optional().default(10).describe("Max results (default 10)"),
      ...accountField,
    },
  },
  async ({ query, max, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "search", query, `--max=${max}`]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Search failed: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "gmail_get",
  {
    title: "Read Email",
    description: "Read a specific email message by its message ID. Returns full message content.",
    inputSchema: {
      messageId: z.string().describe("Gmail message ID"),
      format: z.enum(["full", "metadata", "raw"]).optional().default("full").describe("Message format"),
      headers: z.string().optional().describe("Comma-separated metadata headers when format is metadata"),
      ...accountField,
    },
  },
  async ({ messageId, format, headers, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, [
        "gmail",
        "get",
        messageId,
        "--format",
        format,
        ...(headers ? ["--headers", headers] : []),
      ]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to read message: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "gmail_thread",
  {
    title: "Read Email Thread",
    description: "Read an entire email thread by thread ID. Returns all messages in the conversation.",
    inputSchema: {
      threadId: z.string().describe("Gmail thread ID"),
      full: z.boolean().optional().describe("Include full message bodies"),
      downloadAttachments: z.boolean().optional().describe("Download thread attachments"),
      outDir: z.string().optional().describe("Directory for downloaded attachments"),
      ...accountField,
    },
  },
  async ({ threadId, full, downloadAttachments, outDir, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, [
        "gmail",
        "thread",
        "get",
        threadId,
        ...(full ? ["--full"] : []),
        ...(downloadAttachments ? ["--download"] : []),
        ...(outDir ? ["--out-dir", outDir] : []),
      ]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to read thread: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "gmail_send",
  {
    title: "Send Email",
    description: "Send an email. Can also reply to an existing thread.",
    inputSchema: {
      to: z.string().describe("Recipient email addresses (comma-separated)"),
      subject: z.string().describe("Email subject"),
      body: z.string().optional().describe("Email body (plain text)"),
      bodyHtml: z.string().optional().describe("HTML email body"),
      cc: z.string().optional().describe("CC recipients (comma-separated)"),
      bcc: z.string().optional().describe("BCC recipients (comma-separated)"),
      threadId: z.string().optional().describe("Thread ID to reply within"),
      replyToMessageId: z.string().optional().describe("Gmail message ID to reply to"),
      replyAll: z.boolean().optional().describe("Auto-populate recipients from the original message"),
      replyTo: z.string().optional().describe("Reply-To header address"),
      from: z.string().optional().describe("Verified send-as alias to send from"),
      attachments: z.array(z.string()).optional().describe("Attachment file paths"),
      quote: z.boolean().optional().describe("Include quoted original when replying"),
      track: z.boolean().optional().describe("Enable open tracking if configured"),
      ...accountField,
    },
  },
  async ({
    to,
    subject,
    body,
    bodyHtml,
    cc,
    bcc,
    threadId,
    replyToMessageId,
    replyAll,
    replyTo,
    from,
    attachments,
    quote,
    track,
    account,
  }) => {
    const acc = currentAccount(account);
    if (!body && !bodyHtml) return toolError("Provide body or bodyHtml.");
    try {
      const args = ["gmail", "send", "--to", to, "--subject", subject, "--force"];
      addOptional(args, "--body", body);
      addOptional(args, "--body-html", bodyHtml);
      addOptional(args, "--cc", cc);
      addOptional(args, "--bcc", bcc);
      addOptional(args, "--thread-id", threadId);
      addOptional(args, "--reply-to-message-id", replyToMessageId);
      addBoolean(args, "--reply-all", replyAll);
      addOptional(args, "--reply-to", replyTo);
      addOptional(args, "--from", from);
      addRepeated(args, "--attach", attachments);
      addBoolean(args, "--quote", quote);
      addBoolean(args, "--track", track);
      const result = gogPlain(acc, args);
      const sentFrom = acc ? `Sent from ${acc}.` : "Email sent.";
      return { content: [{ type: "text", text: result ? `${sentFrom}\n\n${result}` : sentFrom }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to send: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "gmail_reply",
  {
    title: "Reply To Email",
    description:
      "Reply to a Gmail message or thread. Use replyAll to let Gmail derive recipients from the original message.",
    inputSchema: {
      messageId: z.string().optional().describe("Gmail message ID to reply to"),
      threadId: z.string().optional().describe("Gmail thread ID to reply within"),
      to: z.string().optional().describe("Recipient email addresses when not using replyAll"),
      subject: z.string().describe("Reply subject"),
      body: z.string().optional().describe("Reply body (plain text)"),
      bodyHtml: z.string().optional().describe("Reply body (HTML)"),
      cc: z.string().optional().describe("CC recipients (comma-separated)"),
      bcc: z.string().optional().describe("BCC recipients (comma-separated)"),
      replyAll: z.boolean().optional().default(true).describe("Auto-populate recipients from the original message"),
      quote: z.boolean().optional().describe("Include quoted original message"),
      from: z.string().optional().describe("Verified send-as alias to send from"),
      attachments: z.array(z.string()).optional().describe("Attachment file paths"),
      ...accountField,
    },
  },
  async ({ messageId, threadId, to, subject, body, bodyHtml, cc, bcc, replyAll, quote, from, attachments, account }) => {
    const acc = currentAccount(account);
    if (!messageId && !threadId) return toolError("Provide messageId or threadId.");
    if (!body && !bodyHtml) return toolError("Provide body or bodyHtml.");
    if (!replyAll && !to) return toolError("Provide to when replyAll is false.");

    try {
      const args = ["gmail", "send", "--subject", subject, "--force"];
      addOptional(args, "--body", body);
      addOptional(args, "--body-html", bodyHtml);
      addOptional(args, "--to", to);
      addOptional(args, "--cc", cc);
      addOptional(args, "--bcc", bcc);
      addOptional(args, "--reply-to-message-id", messageId);
      addOptional(args, "--thread-id", threadId);
      addBoolean(args, "--reply-all", replyAll);
      addBoolean(args, "--quote", quote);
      addOptional(args, "--from", from);
      addRepeated(args, "--attach", attachments);

      const result = gogPlain(acc, args);
      const sentFrom = acc ? `Reply sent from ${acc}.` : "Reply sent.";
      return { content: [{ type: "text", text: result ? `${sentFrom}\n\n${result}` : sentFrom }] };
    } catch (e: any) {
      return toolError(`Failed to reply: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_forward",
  {
    title: "Forward Email",
    description: "Forward a Gmail message to new recipients, preserving the original message and attachments by default.",
    inputSchema: {
      messageId: z.string().describe("Gmail message ID to forward"),
      to: z.string().describe("Recipient email addresses (comma-separated)"),
      cc: z.string().optional().describe("CC recipients (comma-separated)"),
      bcc: z.string().optional().describe("BCC recipients (comma-separated)"),
      note: z.string().optional().describe("Introductory text above the forwarded message"),
      noteFile: z.string().optional().describe("Path to a plain-text note file, or '-' for stdin"),
      from: z.string().optional().describe("Verified send-as alias to send from"),
      skipAttachments: z.boolean().optional().describe("Do not include original attachments"),
      ...accountField,
    },
  },
  async ({ messageId, to, cc, bcc, note, noteFile, from, skipAttachments, account }) => {
    const acc = currentAccount(account);

    try {
      const args = ["gmail", "forward", messageId, "--to", to, "--force"];
      addOptional(args, "--cc", cc);
      addOptional(args, "--bcc", bcc);
      addOptional(args, "--note", note);
      addOptional(args, "--note-file", noteFile);
      addOptional(args, "--from", from);
      addBoolean(args, "--skip-attachments", skipAttachments);

      const result = gogPlain(acc, args);
      const sentFrom = acc ? `Forward sent from ${acc}.` : "Forward sent.";
      return { content: [{ type: "text", text: result ? `${sentFrom}\n\n${result}` : sentFrom }] };
    } catch (e: any) {
      return toolError(`Failed to forward: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_messages_search",
  {
    title: "Search Gmail Messages",
    description: "Search individual Gmail messages using Gmail query syntax.",
    inputSchema: {
      query: z.string().describe("Gmail search query"),
      max: z.number().optional().default(10).describe("Max results"),
      page: z.string().optional().describe("Page token"),
      all: z.boolean().optional().describe("Fetch all pages"),
      includeBody: z.boolean().optional().describe("Include decoded message bodies"),
      timezone: z.string().optional().describe("Output timezone (IANA name, e.g. America/Los_Angeles)"),
      ...accountField,
    },
  },
  async ({ query, max, page, all, includeBody, timezone, account }) => {
    const acc = currentAccount(account);
    try {
      const args = ["gmail", "messages", "search", query, `--max=${max}`];
      addOptional(args, "--page", page);
      addBoolean(args, "--all", all);
      addBoolean(args, "--include-body", includeBody);
      addOptional(args, "--timezone", timezone);
      const result = gog(acc, args);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Message search failed: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_messages_modify",
  {
    title: "Modify Message Labels",
    description:
      "Apply or remove Gmail labels/tags on one or more message IDs. System labels like UNREAD, STARRED, IMPORTANT, and INBOX may be used where Gmail allows them.",
    inputSchema: {
      messageIds: z.array(z.string()).min(1).describe("Gmail message IDs"),
      addLabels: z.string().optional().describe("Labels/tags to add (comma-separated, name or ID)"),
      removeLabels: z.string().optional().describe("Labels/tags to remove (comma-separated, name or ID)"),
      ...accountField,
    },
  },
  async ({ messageIds, addLabels, removeLabels, account }) => {
    const acc = currentAccount(account);
    if (!addLabels && !removeLabels) return toolError("Provide addLabels or removeLabels.");
    try {
      const args = ["gmail", "batch", "modify", ...messageIds];
      addOptional(args, "--add", addLabels);
      addOptional(args, "--remove", removeLabels);
      const result = gog(acc, args);
      return { content: [{ type: "text", text: result || "Messages updated." }] };
    } catch (e: any) {
      return toolError(`Failed to modify messages: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_messages_delete",
  {
    title: "Permanently Delete Messages",
    description: "Permanently delete one or more Gmail messages. This is destructive and cannot be undone.",
    inputSchema: {
      messageIds: z.array(z.string()).min(1).describe("Gmail message IDs to permanently delete"),
      confirm: z.boolean().describe("Must be true after verifying permanent deletion is intended"),
      ...accountField,
    },
  },
  async ({ messageIds, confirm, account }) => {
    const confirmed = confirmDangerous(confirm, "permanently delete Gmail messages");
    if (confirmed) return confirmed;
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "batch", "delete", ...messageIds, "--force"]);
      return { content: [{ type: "text", text: result || "Messages permanently deleted." }] };
    } catch (e: any) {
      return toolError(`Failed to delete messages: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_labels_list",
  {
    title: "List Gmail Labels",
    description: "List Gmail labels/tags.",
    inputSchema: { ...accountField },
  },
  async (args: { account?: string } = {}) => {
    const acc = currentAccount(args.account);
    try {
      const result = gog(acc, ["gmail", "labels", "list"]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Failed to list labels: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_label_get",
  {
    title: "Get Gmail Label",
    description: "Get Gmail label/tag details, including counts.",
    inputSchema: {
      label: z.string().describe("Label name or ID"),
      ...accountField,
    },
  },
  async ({ label, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "labels", "get", label]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Failed to get label: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_label_create",
  {
    title: "Create Gmail Label",
    description: "Create a Gmail label/tag.",
    inputSchema: {
      name: z.string().describe("Label name"),
      ...accountField,
    },
  },
  async ({ name, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "labels", "create", name]);
      return { content: [{ type: "text", text: result || `Created label ${name}.` }] };
    } catch (e: any) {
      return toolError(`Failed to create label: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_label_delete",
  {
    title: "Delete Gmail Label",
    description: "Delete a Gmail label/tag by name or ID.",
    inputSchema: {
      label: z.string().describe("Label name or ID"),
      confirm: z.boolean().describe("Must be true after verifying the label should be deleted"),
      ...accountField,
    },
  },
  async ({ label, confirm, account }) => {
    const confirmed = confirmDangerous(confirm, `delete Gmail label ${label}`);
    if (confirmed) return confirmed;
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "labels", "delete", label, "--force"]);
      return { content: [{ type: "text", text: result || `Deleted label ${label}.` }] };
    } catch (e: any) {
      return toolError(`Failed to delete label: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_threads_modify",
  {
    title: "Modify Thread Labels",
    description: "Apply or remove Gmail labels/tags on one or more thread IDs.",
    inputSchema: {
      threadIds: z.array(z.string()).min(1).describe("Gmail thread IDs"),
      addLabels: z.string().optional().describe("Labels/tags to add (comma-separated, name or ID)"),
      removeLabels: z.string().optional().describe("Labels/tags to remove (comma-separated, name or ID)"),
      ...accountField,
    },
  },
  async ({ threadIds, addLabels, removeLabels, account }) => {
    const acc = currentAccount(account);
    if (!addLabels && !removeLabels) return toolError("Provide addLabels or removeLabels.");
    try {
      const args = ["gmail", "labels", "modify", ...threadIds];
      addOptional(args, "--add", addLabels);
      addOptional(args, "--remove", removeLabels);
      const result = gog(acc, args);
      return { content: [{ type: "text", text: result || "Threads updated." }] };
    } catch (e: any) {
      return toolError(`Failed to modify threads: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_filters_list",
  {
    title: "List Gmail Filters",
    description: "List Gmail filters.",
    inputSchema: { ...accountField },
  },
  async (args: { account?: string } = {}) => {
    const acc = currentAccount(args.account);
    try {
      const result = gog(acc, ["gmail", "settings", "filters", "list"]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Failed to list filters: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_filter_get",
  {
    title: "Get Gmail Filter",
    description: "Get a Gmail filter by ID.",
    inputSchema: {
      filterId: z.string().describe("Gmail filter ID"),
      ...accountField,
    },
  },
  async ({ filterId, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "settings", "filters", "get", filterId]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Failed to get filter: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_filter_create",
  {
    title: "Create Gmail Filter",
    description:
      "Create a Gmail filter with matching criteria and actions such as add/remove labels, archive, mark read, star, forward, trash, never spam, or important.",
    inputSchema: {
      from: z.string().optional().describe("Match messages from this sender"),
      to: z.string().optional().describe("Match messages to this recipient"),
      subject: z.string().optional().describe("Match messages with this subject"),
      query: z.string().optional().describe("Advanced Gmail search query for matching"),
      hasAttachment: z.boolean().optional().describe("Match messages with attachments"),
      addLabel: z.string().optional().describe("Label(s) to add (comma-separated, name or ID)"),
      removeLabel: z.string().optional().describe("Label(s) to remove (comma-separated, name or ID)"),
      archive: z.boolean().optional().describe("Archive matching messages"),
      markRead: z.boolean().optional().describe("Mark matching messages as read"),
      star: z.boolean().optional().describe("Star matching messages"),
      forward: z.string().optional().describe("Forward matching messages to this verified forwarding address"),
      trash: z.boolean().optional().describe("Move matching messages to trash"),
      neverSpam: z.boolean().optional().describe("Never mark matching messages as spam"),
      important: z.boolean().optional().describe("Mark matching messages as important"),
      ...accountField,
    },
  },
  async ({
    from,
    to,
    subject,
    query,
    hasAttachment,
    addLabel,
    removeLabel,
    archive,
    markRead,
    star,
    forward,
    trash,
    neverSpam,
    important,
    account,
  }) => {
    const hasCriteria = from || to || subject || query || hasAttachment;
    const hasAction = addLabel || removeLabel || archive || markRead || star || forward || trash || neverSpam || important;
    if (!hasCriteria) return toolError("Provide at least one filter criterion.");
    if (!hasAction) return toolError("Provide at least one filter action.");

    const acc = currentAccount(account);
    try {
      const args = ["gmail", "settings", "filters", "create"];
      addOptional(args, "--from", from);
      addOptional(args, "--to", to);
      addOptional(args, "--subject", subject);
      addOptional(args, "--query", query);
      addBoolean(args, "--has-attachment", hasAttachment);
      addOptional(args, "--add-label", addLabel);
      addOptional(args, "--remove-label", removeLabel);
      addBoolean(args, "--archive", archive);
      addBoolean(args, "--mark-read", markRead);
      addBoolean(args, "--star", star);
      addOptional(args, "--forward", forward);
      addBoolean(args, "--trash", trash);
      addBoolean(args, "--never-spam", neverSpam);
      addBoolean(args, "--important", important);
      const result = gog(acc, args);
      return { content: [{ type: "text", text: result || "Filter created." }] };
    } catch (e: any) {
      return toolError(`Failed to create filter: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_filter_delete",
  {
    title: "Delete Gmail Filter",
    description: "Delete a Gmail filter by ID.",
    inputSchema: {
      filterId: z.string().describe("Gmail filter ID"),
      confirm: z.boolean().describe("Must be true after verifying the filter should be deleted"),
      ...accountField,
    },
  },
  async ({ filterId, confirm, account }) => {
    const confirmed = confirmDangerous(confirm, `delete Gmail filter ${filterId}`);
    if (confirmed) return confirmed;
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "settings", "filters", "delete", filterId, "--force"]);
      return { content: [{ type: "text", text: result || `Deleted filter ${filterId}.` }] };
    } catch (e: any) {
      return toolError(`Failed to delete filter: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_forwarding_list",
  {
    title: "List Gmail Forwarding Addresses",
    description: "List configured Gmail forwarding addresses.",
    inputSchema: { ...accountField },
  },
  async (args: { account?: string } = {}) => {
    const acc = currentAccount(args.account);
    try {
      const result = gog(acc, ["gmail", "settings", "forwarding", "list"]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Failed to list forwarding addresses: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_forwarding_create",
  {
    title: "Create Gmail Forwarding Address",
    description: "Create/add a Gmail forwarding address. Gmail may require verification before it can be used.",
    inputSchema: {
      email: z.string().describe("Forwarding email address"),
      ...accountField,
    },
  },
  async ({ email, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "settings", "forwarding", "create", email]);
      return { content: [{ type: "text", text: result || `Created forwarding address ${email}.` }] };
    } catch (e: any) {
      return toolError(`Failed to create forwarding address: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_forwarding_delete",
  {
    title: "Delete Gmail Forwarding Address",
    description: "Delete a Gmail forwarding address.",
    inputSchema: {
      email: z.string().describe("Forwarding email address"),
      confirm: z.boolean().describe("Must be true after verifying the forwarding address should be deleted"),
      ...accountField,
    },
  },
  async ({ email, confirm, account }) => {
    const confirmed = confirmDangerous(confirm, `delete Gmail forwarding address ${email}`);
    if (confirmed) return confirmed;
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["gmail", "settings", "forwarding", "delete", email, "--force"]);
      return { content: [{ type: "text", text: result || `Deleted forwarding address ${email}.` }] };
    } catch (e: any) {
      return toolError(`Failed to delete forwarding address: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_auto_forward_get",
  {
    title: "Get Gmail Auto-Forwarding",
    description: "Get current Gmail auto-forwarding settings.",
    inputSchema: { ...accountField },
  },
  async (args: { account?: string } = {}) => {
    const acc = currentAccount(args.account);
    try {
      const result = gog(acc, ["gmail", "settings", "autoforward", "get"]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return toolError(`Failed to get auto-forwarding settings: ${e.message}`);
    }
  },
);

server.registerTool(
  "gmail_auto_forward_update",
  {
    title: "Update Gmail Auto-Forwarding",
    description: "Enable or disable Gmail auto-forwarding to a verified forwarding address.",
    inputSchema: {
      enable: z.boolean().optional().describe("Enable auto-forwarding"),
      disable: z.boolean().optional().describe("Disable auto-forwarding"),
      email: z.string().optional().describe("Verified forwarding email address"),
      disposition: z
        .enum(["leaveInInbox", "archive", "trash", "markRead"])
        .optional()
        .describe("What to do with forwarded messages"),
      confirm: z.boolean().describe("Must be true after verifying the mailbox-wide forwarding change"),
      ...accountField,
    },
  },
  async ({ enable, disable, email, disposition, confirm, account }) => {
    const confirmed = confirmDangerous(confirm, "update Gmail auto-forwarding");
    if (confirmed) return confirmed;
    if ((enable && disable) || (!enable && !disable)) return toolError("Set exactly one of enable or disable.");
    if (enable && !email) return toolError("Provide email when enabling auto-forwarding.");
    const acc = currentAccount(account);
    try {
      const args = ["gmail", "settings", "autoforward", "update"];
      addBoolean(args, "--enable", enable);
      addBoolean(args, "--disable", disable);
      addOptional(args, "--email", email);
      addOptional(args, "--disposition", disposition);
      const result = gog(acc, args);
      return { content: [{ type: "text", text: result || "Auto-forwarding updated." }] };
    } catch (e: any) {
      return toolError(`Failed to update auto-forwarding: ${e.message}`);
    }
  },
);

// ── Calendar ────────────────────────────────────────────────────────────

server.registerTool(
  "calendar_list",
  {
    title: "List Calendars",
    description: "List all available Google calendars.",
    inputSchema: {
      ...accountField,
    },
  },
  async (args: { account?: string } = {}) => {
    const acc = currentAccount(args.account);
    try {
      const result = gog(acc, ["cal", "calendars"]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to list calendars: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "calendar_events",
  {
    title: "List Calendar Events",
    description:
      "List upcoming calendar events. Supports relative dates: 'today', 'tomorrow', 'monday', or RFC3339 timestamps.",
    inputSchema: {
      from: z.string().optional().describe("Start time (e.g. 'today', 'tomorrow', '2026-03-01')"),
      to: z.string().optional().describe("End time"),
      today: z.boolean().optional().describe("Show today's events only"),
      days: z.number().optional().describe("Show events for next N days"),
      max: z.number().optional().default(20).describe("Max results (default 20)"),
      calendarId: z.string().optional().describe("Calendar ID (default: primary)"),
      ...accountField,
    },
  },
  async ({ from, to, today, days, max, calendarId, account }) => {
    const acc = currentAccount(account);
    try {
      const args: string[] = ["cal", "events"];
      if (calendarId) args.push(calendarId);
      args.push(
        ...(today
          ? ["--today"]
          : days
            ? [`--days=${days}`]
            : [...(from ? ["--from", from] : []), ...(to ? ["--to", to] : [])]),
      );
      args.push(`--max=${max}`);
      const result = gog(acc, args);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to list events: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "calendar_search",
  {
    title: "Search Calendar",
    description: "Search calendar events by text query.",
    inputSchema: {
      query: z.string().describe("Search query"),
      from: z.string().optional().describe("Start time"),
      to: z.string().optional().describe("End time"),
      ...accountField,
    },
  },
  async ({ query, from, to, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["cal", "search", query, ...(from ? ["--from", from] : []), ...(to ? ["--to", to] : [])]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `No events found or search failed: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "calendar_create",
  {
    title: "Create Calendar Event",
    description: "Create a new calendar event.",
    inputSchema: {
      summary: z.string().describe("Event title"),
      from: z.string().describe("Start time (RFC3339 or relative like 'tomorrow 2pm')"),
      to: z.string().describe("End time (RFC3339 or relative)"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      attendees: z.string().optional().describe("Attendee emails (comma-separated)"),
      calendarId: z.string().optional().default("primary").describe("Calendar ID (default: primary)"),
      ...accountField,
    },
  },
  async ({ summary, from, to, description, location, attendees, calendarId, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gogPlain(acc, [
        "cal",
        "create",
        calendarId,
        "--summary",
        summary,
        "--from",
        from,
        "--to",
        to,
        "--force",
        ...(description ? ["--description", description] : []),
        ...(location ? ["--location", location] : []),
        ...(attendees ? ["--attendees", attendees] : []),
      ]);
      return { content: [{ type: "text", text: result || "Event created." }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to create event: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "calendar_freebusy",
  {
    title: "Check Free/Busy",
    description: "Check free/busy status for a time range.",
    inputSchema: {
      from: z.string().describe("Start time"),
      to: z.string().describe("End time"),
      calendarIds: z.string().optional().default("primary").describe("Calendar IDs (comma-separated)"),
      ...accountField,
    },
  },
  async ({ from, to, calendarIds, account }) => {
    const acc = currentAccount(account);
    try {
      const result = gog(acc, ["cal", "freebusy", calendarIds, "--from", from, "--to", to]);
      return { content: [{ type: "text", text: result }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Failed to check free/busy: ${e.message}` }], isError: true };
    }
  },
);

// ── Drive ─────────────────────────────────────────────────────────────

const SHARED_FOLDER = process.env.DRIVE_SHARED_FOLDER ?? "";
const INSTANCE_ID = process.env.INSTANCE_ID ?? "hive";
const DOWNLOAD_DIR = join("/tmp", `${INSTANCE_ID}-drive-downloads`);
mkdirSync(DOWNLOAD_DIR, { recursive: true });

server.registerTool(
  "drive_upload",
  {
    title: "Upload File to Google Drive",
    description:
      "Upload a local file to the company shared Google Drive folder. " +
      "Returns a shareable link. Use this to share CSVs, reports, documents with the team. " +
      "The file must exist on the local filesystem (e.g. from permit_export_csv or other export tools).",
    inputSchema: {
      file_path: z.string().describe("Absolute path to the local file to upload"),
      name: z.string().optional().describe("Override the filename in Drive (defaults to local filename)"),
      ...accountField,
    },
  },
  async ({ file_path, name, account }) => {
    const acc = currentAccount(account);
    if (!SHARED_FOLDER) {
      return {
        content: [{ type: "text", text: "Drive shared folder not configured (DRIVE_SHARED_FOLDER)." }],
        isError: true,
      };
    }

    if (!existsSync(file_path)) {
      return { content: [{ type: "text", text: `File not found: ${file_path}` }], isError: true };
    }

    const fileName = name || basename(file_path);

    try {
      const result = gog(acc, ["drive", "upload", file_path, "--parent", SHARED_FOLDER, "--name", fileName]);
      const data = JSON.parse(result);

      const summary = [
        `Uploaded to Google Drive`,
        `  Name: ${data.name || fileName}`,
        ...(data.webViewLink ? [`  View: ${data.webViewLink}`] : []),
        ...(data.id ? [`  File ID: ${data.id}`] : []),
      ].join("\n");

      return { content: [{ type: "text", text: summary }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Upload failed: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "drive_download",
  {
    title: "Download File from Google Drive",
    description:
      "Download a file from Google Drive to the local filesystem for processing. " +
      "Provide either a file ID or a Drive URL. For Google Docs/Sheets/Slides, exports as text/CSV.",
    inputSchema: {
      file_id: z.string().optional().describe("Google Drive file ID"),
      url: z.string().optional().describe("Google Drive URL (file ID will be extracted)"),
      format: z.string().optional().describe("Export format (e.g. txt, csv, pdf). Only for Google-native files."),
      ...accountField,
    },
  },
  async ({ file_id, url, format, account }) => {
    const acc = currentAccount(account);
    let id = file_id;

    if (!id && url) {
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) ?? url.match(/id=([a-zA-Z0-9_-]+)/);
      if (match) id = match[1];
    }

    if (!id) {
      return { content: [{ type: "text", text: "Provide either file_id or a Google Drive URL." }], isError: true };
    }

    try {
      const outPath = join(DOWNLOAD_DIR, id + (format ? `.${format}` : ""));
      const args = ["drive", "download", id, "--out", outPath];
      if (format) args.push("--format", format);
      gogPlain(acc, args);

      // Return inline content for text-readable files
      const textExtensions = new Set([".txt", ".csv", ".md", ".json", ".xml", ".html", ".tsv"]);
      const ext = outPath.includes(".") ? outPath.slice(outPath.lastIndexOf(".")) : "";
      if (existsSync(outPath) && textExtensions.has(ext)) {
        const content = readFileSync(outPath, "utf-8");
        const summary = [
          `Downloaded${format ? ` and exported as ${format}` : ""}`,
          `  Local path: ${outPath}`,
          ``,
          `--- Content ---`,
          content,
        ].join("\n");
        return { content: [{ type: "text", text: summary }] };
      }

      return { content: [{ type: "text", text: `Downloaded to ${outPath}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Download failed: ${e.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "drive_list",
  {
    title: "List Files in Shared Drive Folder",
    description:
      "List files in the company shared Drive folder. Useful to see what reports and documents have been shared.",
    inputSchema: {
      query: z.string().optional().describe("Search query to filter files (e.g. 'permits' or 'name contains report')"),
      limit: z.number().optional().default(20).describe("Max results (default 20)"),
      ...accountField,
    },
  },
  async ({ query, limit, account }) => {
    const acc = currentAccount(account);
    if (!SHARED_FOLDER) {
      return { content: [{ type: "text", text: "Drive shared folder not configured." }], isError: true };
    }

    try {
      const args = ["drive", "ls", "--parent", SHARED_FOLDER];
      if (query) args.push("--query", query);
      args.push(`--max=${limit ?? 20}`);
      const result = gog(acc, args);

      // Format as human-readable text
      try {
        const files = JSON.parse(result);
        if (!Array.isArray(files) || files.length === 0) {
          return { content: [{ type: "text", text: "No files found." }] };
        }
        const lines = files.map((f: Record<string, unknown>) => {
          const name = (f.name as string) || "Untitled";
          const size = (f.size as string) || "—";
          const modified = (f.modifiedTime as string) ? new Date(f.modifiedTime as string).toLocaleDateString() : "—";
          const link = (f.webViewLink as string) || "";
          return `📄 ${name} — ${size} — ${modified}${link ? ` — ${link}` : ""}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch {
        // Parse failed — return raw output
        return { content: [{ type: "text", text: result || "No files found." }] };
      }
    } catch (e: any) {
      return { content: [{ type: "text", text: `List failed: ${e.message}` }], isError: true };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
