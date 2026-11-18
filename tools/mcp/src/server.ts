import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AppData } from '../../../src/domain/budget/models.ts'
import { BackupStore } from './backup.ts'
import { MAX_CHANGES_PER_CALL } from './config.ts'
import { DEFAULT_LIMIT, MAX_LIMIT, ToolError } from './helpers.ts'
import { log } from './log.ts'
import * as operations from './operations.ts'
import * as read from './readTools.ts'
import type { DocumentStore } from './store.ts'
import { readDocument, restoreBackup, runWrite, type WriteContext } from './writeTools.ts'

export interface ServerOptions {
  store: DocumentStore
  backups: BackupStore
  /** When true the write tools are not registered at all. */
  readOnly: boolean
  newMutationId?: () => string
}

type Shape = z.ZodRawShape

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Shape
  write: boolean
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

const SPENDING_RULES =
  'Spending = EUR transactions only, dated by bookingDate; amounts are signed as on the bank statement (negative = money out). ' +
  'An expense-kind transaction with a negative amount counts -amountCents; every transaction\'s fee counts too; income and transfer rows are not spending; ' +
  'refunds still marked expense (positive) add nothing. Expenses without category are "(uncategorised)". Same rules as the web app\'s month summary.'

const AMOUNTS = 'Amounts are {cents, formatted}.'

const month = z.string().describe('Month as YYYY-MM')
const date = z.string().describe('Date YYYY-MM-DD (inclusive), or YYYY-MM for the whole month')
const limit = z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Page size, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}`)
const offset = z.number().int().min(0).optional().describe('Items to skip, default 0 (see nextOffset)')
const kind = z.enum(['expense', 'income', 'transfer'])
const dryRun = z.boolean().optional().describe('Default true: only show the diff. false: back up, then write.')
const id = z.string().min(1)
const ids = z.array(id).min(1).max(MAX_CHANGES_PER_CALL)

const WRITE_NOTE =
  ` Safeguards: dry_run defaults to true and returns a before/after diff without writing; with dry_run false the current document is backed up locally first, then saved with a compare-and-swap on the revision read (a conflict returns an error, nothing is retried). At most ${MAX_CHANGES_PER_CALL} changed transactions/items per call; any unknown id or unresolved category fails the whole call.`

export function buildTools(options: ServerOptions): ToolDefinition[] {
  const context: WriteContext = {
    store: options.store,
    backups: options.backups,
    newMutationId: options.newMutationId,
  }
  const withData = <A>(view: (data: AppData, args: A) => unknown) =>
    async (args: Record<string, unknown>) => view((await readDocument(options.store)).data, args as A)
  const write = (reason: (args: Record<string, unknown>) => string, apply: (data: AppData, args: Record<string, unknown>) => operations.OperationResult) =>
    (args: Record<string, unknown>) =>
      runWrite(context, { dryRun: args.dry_run as boolean | undefined, reason: reason(args) }, (data) => apply(data, args))

  const tools: ToolDefinition[] = [
    {
      name: 'list_months',
      description: `Months that have a budget or transactions, newest first, with planned and spent totals and the number of uncategorised expenses. ${AMOUNTS} ${SPENDING_RULES}`,
      inputSchema: {},
      write: false,
      handler: withData((data) => read.listMonths(data)),
    },
    {
      name: 'get_budget',
      description: `The budget of one month: incomes, accounts, expense categories with their items (ids for the write tools), the planned summary (income, planned expenses, remaining, savings rate, account allocations) and actual spending. ${AMOUNTS}`,
      inputSchema: { month },
      write: false,
      handler: withData(read.getBudget),
    },
    {
      name: 'list_categories',
      description: 'Expense categories with id, name and month. Categories belong to ONE month: a transaction can only use a category of its own month (same name in another month = another id). Omit month for every month.',
      inputSchema: { month: month.optional() },
      write: false,
      handler: withData(read.listCategories),
    },
    {
      name: 'list_transactions',
      description: `Imported bank transactions, newest first, paginated (total, nextOffset). Filters: month, from/to, category (id, name, or "none"), text (in the description, case/accents ignored), kind. Each row shows kind (expense|income|transfer) and category. ${AMOUNTS} amountCents is negative for money out.`,
      inputSchema: {
        month: month.optional(), from: date.optional(), to: date.optional(),
        category: z.string().optional(), text: z.string().optional(), kind: kind.optional(), limit, offset,
      },
      write: false,
      handler: withData(read.listTransactions),
    },
    {
      name: 'list_uncategorized',
      description: `Expense transactions without a category, newest first, paginated. ${AMOUNTS}`,
      inputSchema: { month: month.optional(), limit, offset },
      write: false,
      handler: withData(read.listUncategorized),
    },
    {
      name: 'merchant_summary',
      description: `Transactions grouped by merchant (description with case, accents and punctuation ignored): count, signed EUR total, kind and current category (or "mixed: ..."), first/last date. Sorted by absolute total, paginated. Use it to plan categorize_by_description / set_kind_by_description. ${AMOUNTS}`,
      inputSchema: {
        from: date.optional(), to: date.optional(), kind: kind.optional(),
        uncategorized_only: z.boolean().optional().describe('Only expenses without a category'), limit, offset,
      },
      write: false,
      handler: withData((data, args: Record<string, unknown>) => read.merchantSummary(data, {
        from: args.from as string | undefined, to: args.to as string | undefined,
        kind: args.kind as read.MerchantArgs['kind'], uncategorizedOnly: args.uncategorized_only as boolean | undefined,
        limit: args.limit as number | undefined, offset: args.offset as number | undefined,
      })),
    },
    {
      name: 'spending_by_category',
      description: `Spending between two dates by category name (grouped across months), with the planned amounts of the budget months in range. Fees of income/transfer rows are in "(fees on income and transfers)". ${AMOUNTS} ${SPENDING_RULES}`,
      inputSchema: { from: date, to: date },
      write: false,
      handler: withData(read.spendingByCategory),
    },
    {
      name: 'monthly_totals',
      description: `Per month between two months: planned income and expenses, actual received and spent, net, transfer count, uncategorised count. ${AMOUNTS} ${SPENDING_RULES}`,
      inputSchema: { from: month, to: month },
      write: false,
      handler: withData(read.monthlyTotals),
    },
    {
      name: 'list_backups',
      description: 'Local backups taken before each write by this server, newest first (file, savedAt, revision read). Use a file name with restore_backup.',
      inputSchema: {},
      write: false,
      handler: async () => ({ directory: options.backups.directory, backups: await options.backups.list() }),
    },
    {
      name: 'set_transaction_category',
      description: `Sets the category of expense transactions by id (null clears it). The category must belong to each transaction's own month.${WRITE_NOTE}`,
      inputSchema: { ids, categoryId: id.nullable(), dry_run: dryRun },
      write: true,
      handler: write(() => 'set_transaction_category', (data, args) =>
        operations.setTransactionCategory(data, args.ids as string[], args.categoryId as string | null)),
    },
    {
      name: 'categorize_by_description',
      description: `Categorises every EXPENSE between from and to whose description matches (case, accents and punctuation ignored, whole description). The category is resolved by NAME in each transaction's own month (a categoryId is turned into its name first). If a month lacks that category, nothing is applied and the gaps are listed. Already-categorised transactions are kept unless overwrite is true. Diff grouped by merchant.${WRITE_NOTE}`,
      inputSchema: {
        matches: z.array(z.object({
          description: z.string().min(1),
          categoryName: z.string().optional(),
          categoryId: z.string().optional(),
        })).min(1).max(50),
        from: date, to: date,
        overwrite: z.boolean().optional().describe('Replace an existing different category (default false)'),
        dry_run: dryRun,
      },
      write: true,
      handler: write(() => 'categorize_by_description', (data, args) =>
        operations.categorizeByDescription(data, args.matches as operations.CategoryMatch[], {
          from: args.from as string, to: args.to as string, overwrite: args.overwrite as boolean | undefined,
        })),
    },
    {
      name: 'set_transaction_kind',
      description: `Sets kind (expense|income|transfer) of transactions by id, e.g. mark pocket/savings moves or loan repayments as transfer so they leave spending. A non-expense loses its category, as in the web app.${WRITE_NOTE}`,
      inputSchema: { ids, kind, dry_run: dryRun },
      write: true,
      handler: write(() => 'set_transaction_kind', (data, args) =>
        operations.setTransactionKind(data, args.ids as string[], args.kind as 'expense')),
    },
    {
      name: 'set_kind_by_description',
      description: `Sets kind for every transaction between from and to whose description matches (same matching as categorize_by_description). A non-expense loses its category.${WRITE_NOTE}`,
      inputSchema: {
        matches: z.array(z.object({ description: z.string().min(1), kind })).min(1).max(50),
        from: date, to: date, dry_run: dryRun,
      },
      write: true,
      handler: write(() => 'set_kind_by_description', (data, args) =>
        operations.setKindByDescription(data, args.matches as operations.KindMatch[], {
          from: args.from as string, to: args.to as string,
        })),
    },
    {
      name: 'set_planned_amount',
      description: `Sets the planned amount (integer cents, >= 0) of one expense item of a month (ids from get_budget).${WRITE_NOTE}`,
      inputSchema: { month, itemId: id, amountCents: z.number().int().min(0), dry_run: dryRun },
      write: true,
      handler: write(() => 'set_planned_amount', (data, args) =>
        operations.setPlannedAmount(data, args.month as string, args.itemId as string, args.amountCents as number)),
    },
    {
      name: 'add_expense_item',
      description: `Adds an expense item at the end of a category of a month.${WRITE_NOTE}`,
      inputSchema: { month, categoryId: id, name: z.string().min(1).max(200), amountCents: z.number().int().min(0), dry_run: dryRun },
      write: true,
      handler: write(() => 'add_expense_item', (data, args) =>
        operations.addExpenseItem(data, args.month as string, args.categoryId as string, args.name as string, args.amountCents as number)),
    },
    {
      name: 'rename_item',
      description: `Renames an income, account, category or expense item of a month (renaming a category only affects that month).${WRITE_NOTE}`,
      inputSchema: { month, itemId: id, name: z.string().min(1).max(200), dry_run: dryRun },
      write: true,
      handler: write(() => 'rename_item', (data, args) =>
        operations.renameItem(data, args.month as string, args.itemId as string, args.name as string)),
    },
    {
      name: 'delete_item',
      description: `Deletes one expense item of a month (not a category, income or account).${WRITE_NOTE}`,
      inputSchema: { month, itemId: id, dry_run: dryRun },
      write: true,
      handler: write(() => 'delete_item', (data, args) =>
        operations.deleteItem(data, args.month as string, args.itemId as string)),
    },
    {
      name: 'restore_backup',
      description: 'Replaces the WHOLE cloud document with a local backup (file name from list_backups). dry_run defaults to true and shows what would change; with dry_run false the current document is backed up first and the write uses the current revision.',
      inputSchema: { file: z.string().min(1), dry_run: dryRun },
      write: true,
      handler: (args) => restoreBackup(context, { file: args.file as string, dryRun: args.dry_run as boolean | undefined }),
    },
  ]
  return options.readOnly ? tools.filter((tool) => !tool.write) : tools
}

export async function callTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const value = await tool.handler(args)
    return { content: [{ type: 'text', text: JSON.stringify(value) }] }
  } catch (error) {
    if (error instanceof ToolError) return { isError: true, content: [{ type: 'text', text: error.message }] }
    log(`${tool.name} failed: ${error instanceof Error ? error.stack : String(error)}`)
    return {
      isError: true,
      content: [{ type: 'text', text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
    }
  }
}

export function createFinanceServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: 'finance', version: '0.1.0' },
    {
      instructions:
        'Personal budget and bank transactions of the signed-in owner (one document). Read tools are safe. ' +
        'Write tools default to dry_run: show the diff to the owner and only call again with dry_run: false after they agree. ' +
        (options.readOnly ? 'This server runs read-only: write tools are disabled.' : 'Every real write is backed up locally first (list_backups, restore_backup).'),
    },
  )
  for (const tool of buildTools(options)) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.write
        ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
        : { readOnlyHint: true, openWorldHint: false },
    }, (args: Record<string, unknown>) => callTool(tool, args))
  }
  return server
}
