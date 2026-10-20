import { useEffect, useMemo, useRef, useState } from 'react'
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
import { formatMoney } from '../../domain/budget/money'

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

function useContainerWidth() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(860)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { containerRef, width }
}

export function CashFlowChart({ model }: { model: CashFlowModel }) {
  const { containerRef, width: availableWidth } = useContainerWidth()
  const chartWidth = Math.max(760, Math.floor(availableWidth))
  const chartHeight = Math.max(430, model.nodes.length * 34)

  const graph = useMemo(() => {
    if (model.links.length === 0) return null

    return sankey<NodeDatum, LinkDatum>()
      .nodeId((node) => node.id)
      .nodeWidth(18)
      .nodePadding(18)
      .extent([
        [16, 20],
        [chartWidth - 16, chartHeight - 20],
      ])({
      nodes: model.nodes.map((node) => ({ ...node })),
      links: model.links.map((link) => ({ ...link })),
    })
  }, [chartHeight, chartWidth, model])

  const linkPath = useMemo(
    () => sankeyLinkHorizontal<NodeDatum, LinkDatum>(),
    [],
  )

  return (
    <div ref={containerRef} className="chart-scroll">
      {!graph ? (
        <div className="chart-empty">
          <div aria-hidden="true">↗</div>
          <h3>Le flux apparaîtra ici</h3>
          <p>Ajoutez des montants pour visualiser la circulation de l’argent.</p>
        </div>
      ) : (
        <svg
          className="sankey-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width={chartWidth}
          height={chartHeight}
          role="img"
          aria-labelledby="cash-flow-title cash-flow-description"
        >
          <title id="cash-flow-title">Répartition du budget</title>
          <desc id="cash-flow-description">
            Flux des revenus vers les comptes puis vers les dépenses.
          </desc>
          <g>
            {graph.links.map((link, index) => (
              <path
                key={`${endpointName(link.source)}-${endpointName(link.target)}-${index}`}
                className="sankey-link"
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
              const onLeft = x0 < chartWidth / 2
              return (
                <g key={node.id} className="sankey-node">
                  <rect
                    x={x0}
                    y={y0}
                    width={Math.max(1, x1 - x0)}
                    height={Math.max(2, y1 - y0)}
                    rx="5"
                    fill={nodeColors[node.kind]}
                  />
                  <text
                    x={onLeft ? x1 + 8 : x0 - 8}
                    y={(y0 + y1) / 2}
                    dy="0.35em"
                    textAnchor={onLeft ? 'start' : 'end'}
                  >
                    <tspan>{node.name}</tspan>
                    <tspan className="node-value" dx="5">
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
