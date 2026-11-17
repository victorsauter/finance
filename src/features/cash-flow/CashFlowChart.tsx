import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  sankey,
  sankeyLinkHorizontal,
  type SankeyExtraProperties,
  type SankeyLink,
} from 'd3-sankey'
import type {
  CashFlowModel,
  FlowNode,
  FlowNodeKind,
} from '../../domain/budget/chart-model'
import {
  SANKEY_MIN_WIDTH,
  sankeyHeight,
  truncateLabel,
} from '../../domain/budget/chart-layout'
import { formatMoney } from '../../domain/budget/money'
import { FlowList } from './FlowList'

type NodeDatum = FlowNode & SankeyExtraProperties
type LinkDatum = SankeyExtraProperties
type LayoutLink = SankeyLink<NodeDatum, LinkDatum>

const nodeColors: Record<FlowNodeKind, string> = {
  income: 'var(--flow-income)',
  budget: 'var(--flow-budget)',
  account: 'var(--flow-account)',
  expense: 'var(--flow-expense)',
  saving: 'var(--flow-saving)',
  warning: 'var(--flow-warning)',
}

function endpointName(endpoint: LayoutLink['source']): string {
  return typeof endpoint === 'object' ? endpoint.name : String(endpoint)
}

/** Width of the container, measured before first paint to avoid a flash. */
function useContainerWidth() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { containerRef, width }
}

const NODE_WIDTH = 18
const EDGE = 16
// Average glyph width of the text-xs semibold labels, used to fit names.
const CHAR_WIDTH = 6.6
// Room kept on the right so the last column's labels also sit beside their node.
const LABEL_MARGIN = 128
const LABEL_GAP = 8

export function CashFlowChart({ model }: { model: CashFlowModel }) {
  const { containerRef, width } = useContainerWidth()
  const chartWidth = Math.floor(width ?? 0)
  const chartHeight = sankeyHeight(model.nodes)
  const isNarrow = width !== null && width < SANKEY_MIN_WIDTH
  const showSankey = width !== null && !isNarrow && model.links.length > 0

  const graph = useMemo(() => {
    if (!showSankey) return null

    return sankey<NodeDatum, LinkDatum>()
      .nodeId((node) => node.id)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(26)
      .extent([
        [EDGE, 20],
        [chartWidth - EDGE - LABEL_MARGIN, chartHeight - 20],
      ])({
      nodes: model.nodes.map((node) => ({ ...node })),
      links: model.links.map((link) => ({ ...link })),
    })
  }, [chartHeight, chartWidth, model, showSankey])

  const linkPath = useMemo(
    () => sankeyLinkHorizontal<NodeDatum, LinkDatum>(),
    [],
  )

  // Every label sits right of its node and may use the space up to the next
  // column (or the right margin for the last one), no more.
  const lastLayer = graph
    ? Math.max(...graph.nodes.map((node) => node.layer ?? 0))
    : 0
  const columnSpacing =
    lastLayer > 0
      ? (chartWidth - EDGE * 2 - LABEL_MARGIN - NODE_WIDTH) / lastLayer
      : 0
  const charsFor = (room: number) =>
    Math.max(6, Math.floor((room - LABEL_GAP - 4) / CHAR_WIDTH))
  const middleLabelChars = charsFor(columnSpacing - NODE_WIDTH)
  const lastLabelChars = charsFor(LABEL_MARGIN)

  if (width !== null && model.links.length > 0 && isNarrow) {
    return (
      <div ref={containerRef} className="w-full min-w-0">
        <FlowList model={model} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full min-w-0">
      {width === null ? null : !graph ? (
        <div className="grid min-h-64 place-content-center justify-items-center gap-1 p-6 text-center">
          <div
            aria-hidden="true"
            className="mb-2 grid size-12 place-items-center rounded-xl bg-accent text-lg text-accent-foreground"
          >
            ↗
          </div>
          <h3 className="font-heading text-base font-semibold">
            Your cash flow will appear here
          </h3>
          <p className="text-sm text-muted-foreground">
            Add amounts to visualise how your money moves.
          </p>
        </div>
      ) : (
        <svg
          className="block h-auto max-w-full"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width={chartWidth}
          height={chartHeight}
          role="img"
          aria-labelledby="cash-flow-title cash-flow-description"
        >
          <title id="cash-flow-title">Budget allocation</title>
          <desc id="cash-flow-description">
            Income flows to accounts and then to expenses.
          </desc>
          <g>
            {graph.links.map((link, index) => (
              <path
                key={`${endpointName(link.source)}-${endpointName(link.target)}-${index}`}
                className="fill-none opacity-25 transition-opacity hover:opacity-60"
                d={linkPath(link) ?? undefined}
                stroke={
                  nodeColors[
                    (typeof link.source === 'object'
                      ? link.source.kind
                      : 'budget') as FlowNodeKind
                  ]
                }
                strokeWidth={Math.max(1, link.width ?? 1)}
              >
                <title>
                  {endpointName(link.source)} → {endpointName(link.target)} :{' '}
                  {formatMoney(link.value)}
                </title>
              </path>
            ))}
          </g>
          <g>
            {graph.nodes.map((node) => {
              const x0 = node.x0 ?? 0
              const x1 = node.x1 ?? 0
              const y0 = node.y0 ?? 0
              const y1 = node.y1 ?? 0
              const labelX = x1 + LABEL_GAP
              const maxChars =
                (node.layer ?? 0) >= lastLayer
                  ? lastLabelChars
                  : middleLabelChars
              return (
                <g key={node.id}>
                  <rect
                    x={x0}
                    y={y0}
                    width={Math.max(1, x1 - x0)}
                    height={Math.max(2, y1 - y0)}
                    rx="5"
                    fill={nodeColors[node.kind]}
                  />
                  <text
                    x={labelX}
                    y={(y0 + y1) / 2}
                    className="pointer-events-none fill-foreground stroke-card stroke-3 text-xs font-semibold"
                    // Halo keeps labels readable where they cross a flow band.
                    style={{ paintOrder: 'stroke', strokeLinejoin: 'round' }}
                  >
                    <title>{`${node.name} ${formatMoney(node.value ?? 0)}`}</title>
                    <tspan x={labelX} dy="-0.2em">
                      {truncateLabel(node.name, maxChars)}
                    </tspan>
                    <tspan
                      className="fill-muted-foreground font-normal"
                      x={labelX}
                      dy="1.25em"
                    >
                      {formatMoney(node.value ?? 0)}
                    </tspan>
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )
}
