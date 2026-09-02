import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';

const INF = 1_000_000;

const initialNodes = [
  {
    id: '1',
    type: 'textNode',
    position: { x: 70, y: 240 },
    data: { char: 'b', C: 0, Cnext: null },
  },
  {
    id: '2',
    type: 'textNode',
    position: { x: 290, y: 240 },
    data: { char: 'a', C: 0, Cnext: null },
  },
  {
    id: '3',
    type: 'textNode',
    position: { x: 470, y: 100 },
    data: { char: 'b', C: 0, Cnext: null },
  },
  {
    id: '4',
    type: 'textNode',
    position: { x: 260, y: 100 },
    data: { char: 'b', C: 0, Cnext: null },
  },
  {
    id: '5',
    type: 'textNode',
    position: { x: 500, y: 320 },
    data: { char: 'b', C: 0, Cnext: null },
  },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2-3', source: '2', target: '3', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e3-4', source: '3', target: '4', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e4-2', source: '4', target: '2', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2-5', source: '2', target: '5', markerEnd: { type: MarkerType.ArrowClosed } },
];

function displayValue(value) {
  if (value === null || value === undefined) return '—';
  return value >= INF ? '∞' : String(value);
}

function cloneMap(map) {
  return Object.fromEntries(Object.entries(map));
}

function copyPath(path) {
  return {
    nodes: [...(path?.nodes || [])],
    edges: (path?.edges || []).map((edge) => ({ ...edge })),
    end: path?.end ?? null,
    distance: path?.distance ?? INF,
  };
}

function makeSnapshot({
  kind,
  line,
  message,
  patternIndex,
  patternChar,
  C,
  Cnext,
  bestPath = { nodes: [], edges: [], end: null, distance: INF },
  activeNode = null,
  activeEdge = null,
  changedNodes = [],
  queue = [],
}) {
  return {
    kind,
    line,
    message,
    patternIndex,
    patternChar,
    C: cloneMap(C),
    Cnext: cloneMap(Cnext),
    bestPath: copyPath(bestPath),
    activeNode,
    activeEdge: activeEdge ? { ...activeEdge } : null,
    changedNodes: [...changedNodes],
    queue: queue.map((edge) => ({ ...edge })),
  };
}

function predecessorIds(nodeId, edges) {
  return edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
}

function outgoingEdges(nodeId, edges) {
  return edges.filter((edge) => edge.source === nodeId);
}

function stateKey(patternIndex, nodeId) {
  return `${patternIndex}|${nodeId}`;
}

function reconstructBestPath(C, finalIndex, back) {
  const candidates = Object.entries(C)
    .filter(([, value]) => value < INF)
    .sort(([idA, costA], [idB, costB]) => costA - costB || String(idA).localeCompare(String(idB)));

  if (!candidates.length) {
    return { nodes: [], edges: [], end: null, distance: INF };
  }

  const [end, distance] = candidates[0];
  const reversedNodes = [];
  const reversedEdges = [];
  const visitedStates = new Set();
  let currentIndex = finalIndex;
  let currentNode = end;

  while (currentIndex >= 0 && currentNode !== null && currentNode !== undefined) {
    const key = stateKey(currentIndex, currentNode);
    if (visitedStates.has(key)) break;
    visitedStates.add(key);

    const pointer = back.get(key);
    reversedNodes.push(currentNode);

    if (!pointer || pointer.kind === 'start') break;

    if (pointer.edge) {
      reversedEdges.push({ ...pointer.edge });
    }

    currentIndex = pointer.prevIndex;
    currentNode = pointer.prevNode;
  }

  return {
    nodes: reversedNodes.reverse(),
    edges: reversedEdges.reverse(),
    end,
    distance,
  };
}

function createRun(nodes, edges, pattern) {
  const cleanPattern = pattern.trim();

  if (!cleanPattern) {
    return { error: 'Informe um padrão não vazio.', snapshots: [] };
  }

  if (!nodes.length) {
    return { error: 'Crie pelo menos um vértice.', snapshots: [] };
  }

  const chars = Object.fromEntries(nodes.map((node) => [node.id, node.data.char || '?']));
  const ids = nodes.map((node) => node.id);
  const snapshots = [];

  let C = Object.fromEntries(ids.map((id) => [id, 0]));
  let Cnext = Object.fromEntries(ids.map((id) => [id, null]));

  const back = new Map();
  for (const id of ids) {
    back.set(stateKey(-1, id), {
      kind: 'start',
      prevIndex: null,
      prevNode: null,
      edge: null,
      operation: 'inicialização',
    });
  }

  snapshots.push(makeSnapshot({
    kind: 'init',
    line: 1,
    message: 'Inicialização: C[v] ← 0 para todo vértice v.',
    patternIndex: -1,
    patternChar: '',
    C,
    Cnext,
  }));

  for (let i = 0; i < cleanPattern.length; i += 1) {
    const p = cleanPattern[i];
    Cnext = Object.fromEntries(ids.map((id) => [id, null]));
    const choices = Object.fromEntries(ids.map((id) => [id, null]));

    snapshots.push(makeSnapshot({
      kind: 'iteration',
      line: 2,
      message: `Início da iteração i = ${i + 1}: processando patt[${i + 1}] = “${p}”.`,
      patternIndex: i,
      patternChar: p,
      C,
      Cnext,
    }));

    for (const id of ids) {
      const preds = predecessorIds(id, edges);
      const bestPred = preds.reduce(
        (best, pred) => (C[pred] < best.cost ? { id: pred, cost: C[pred] } : best),
        { id: null, cost: INF },
      );

      if (chars[id] === p) {
        const startCost = i;

        if (bestPred.cost <= startCost) {
          Cnext[id] = bestPred.cost;
          choices[id] = {
            kind: 'match',
            prevIndex: i - 1,
            prevNode: bestPred.id,
            edge: { source: bestPred.id, target: id },
            operation: 'casamento',
          };
        } else {
          Cnext[id] = startCost;
          choices[id] = {
            kind: 'start',
            prevIndex: null,
            prevNode: null,
            edge: null,
            operation: 'início de sufixo',
          };
        }
      } else {
        const alternatives = [
          {
            cost: C[id],
            kind: 'delete-pattern-char',
            prevIndex: i - 1,
            prevNode: id,
            edge: null,
            operation: 'deleção no padrão',
          },
          ...preds.map((pred) => ({
            cost: C[pred],
            kind: 'substitute',
            prevIndex: i - 1,
            prevNode: pred,
            edge: { source: pred, target: id },
            operation: 'substituição',
          })),
        ];

        const best = alternatives.reduce(
          (currentBest, candidate) => (candidate.cost < currentBest.cost ? candidate : currentBest),
          {
            cost: INF,
            kind: 'none',
            prevIndex: null,
            prevNode: null,
            edge: null,
            operation: 'nenhuma',
          },
        );

        Cnext[id] = best.cost >= INF ? INF : best.cost + 1;
        choices[id] = best;
      }

      const choice = choices[id];
      const origin = choice.prevNode === null ? 'início de um novo sufixo' : `v${choice.prevNode}`;
      const formula = chars[id] === p
        ? `t[${id}] = “${chars[id]}” coincide com patt[${i + 1}] = “${p}”. C′[${id}] = ${displayValue(Cnext[id])}; origem: ${origin}.`
        : `t[${id}] = “${chars[id]}” difere de patt[${i + 1}] = “${p}”. C′[${id}] = ${displayValue(Cnext[id])}; operação: ${choice.operation}; origem: ${origin}.`;

      snapshots.push(makeSnapshot({
        kind: 'compute',
        line: 3,
        message: formula,
        patternIndex: i,
        patternChar: p,
        C,
        Cnext,
        activeNode: id,
      }));
    }

    C = cloneMap(Cnext);

    for (const id of ids) {
      const choice = choices[id];
      back.set(stateKey(i, id), {
        kind: choice.kind,
        prevIndex: choice.prevIndex,
        prevNode: choice.prevNode,
        edge: choice.edge ? { ...choice.edge } : null,
        operation: choice.operation,
      });
    }

    snapshots.push(makeSnapshot({
      kind: 'copy',
      line: 4,
      message: 'Linha 4: C[v] ← C′[v] para todos os vértices.',
      patternIndex: i,
      patternChar: p,
      C,
      Cnext,
    }));

    const queue = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      reason: 'varredura inicial',
    }));
    let cursor = 0;

    snapshots.push(makeSnapshot({
      kind: 'propagation-start',
      line: 5,
      message: `Início da propagação: ${queue.length} aresta(s) serão examinadas inicialmente.`,
      patternIndex: i,
      patternChar: p,
      C,
      Cnext,
      queue,
    }));

    while (cursor < queue.length) {
      const currentEdge = queue[cursor];
      cursor += 1;

      const { source, target } = currentEdge;
      const oldValue = C[target];
      const candidate = C[source] >= INF ? INF : C[source] + 1;
      const remaining = queue.slice(cursor);

      snapshots.push(makeSnapshot({
        kind: 'propagate-test',
        line: 'P1',
        message: `Propagate(${source}, ${target}): testar C[${target}] > 1 + C[${source}]. Temos ${displayValue(oldValue)} > ${displayValue(candidate)}?`,
        patternIndex: i,
        patternChar: p,
        C,
        Cnext,
        activeEdge: { source, target },
        queue: remaining,
      }));

      if (oldValue > candidate) {
        C[target] = candidate;

        back.set(stateKey(i, target), {
          kind: 'insert-text-char',
          prevIndex: i,
          prevNode: source,
          edge: { source, target },
          operation: 'inserção no texto',
        });

        const outgoing = outgoingEdges(target, edges).map((edge) => ({
          source: edge.source,
          target: edge.target,
          reason: `C[${target}] diminuiu`,
        }));
        queue.push(...outgoing);

        snapshots.push(makeSnapshot({
          kind: 'propagate-update',
          line: 'P2–P4',
          message: `Atualização: C[${target}] ← ${displayValue(candidate)}. A origem passa a ser v${source}, por inserção no texto. ${outgoing.length} aresta(s) de saída de v${target} entram na fila.`,
          patternIndex: i,
          patternChar: p,
          C,
          Cnext,
          activeNode: target,
          activeEdge: { source, target },
          changedNodes: [target],
          queue: queue.slice(cursor),
        }));
      } else {
        snapshots.push(makeSnapshot({
          kind: 'propagate-nochange',
          line: 'P1',
          message: `Nenhuma atualização em v${target}: a condição é falsa.`,
          patternIndex: i,
          patternChar: p,
          C,
          Cnext,
          activeEdge: { source, target },
          queue: remaining,
        }));
      }
    }

    Cnext = cloneMap(C);

    snapshots.push(makeSnapshot({
      kind: 'iteration-done',
      line: 5,
      message: `Fim da iteração i = ${i + 1}. Os valores C incorporam todas as inserções propagadas.`,
      patternIndex: i,
      patternChar: p,
      C,
      Cnext,
    }));
  }

  const bestPath = reconstructBestPath(C, cleanPattern.length - 1, back);
  const pathText = bestPath.nodes.length
    ? bestPath.nodes.map((id) => `v${id}`).join(' → ')
    : 'nenhum';

  snapshots.push(makeSnapshot({
    kind: 'done',
    line: 'fim',
    message: `Execução concluída. Caminhada testemunha de menor custo: ${pathText}. Distância final mínima: ${displayValue(bestPath.distance)}.`,
    patternIndex: cleanPattern.length - 1,
    patternChar: cleanPattern.at(-1),
    C,
    Cnext,
    bestPath,
  }));

  return { error: null, snapshots };
}

function TextNode({ data, selected }) {
  const className = [
    'text-node',
    selected ? 'selected-node' : '',
    data.active ? 'active-node' : '',
    data.changed ? 'changed-node' : '',
    data.onBestPath ? 'best-path-node' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="node-id">v{data.label}</div>
      <div className="node-char">{data.char || '?'}</div>
      <div className="node-values">
        <span>C: {displayValue(data.C)}</span>
        <span>C′: {displayValue(data.Cnext)}</span>
      </div>
    </div>
  );
}

const nodeTypes = { textNode: TextNode };

function App() {
  return (
    <ReactFlowProvider>
      <Visualizer />
    </ReactFlowProvider>
  );
}

function Visualizer() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [pattern, setPattern] = useState('bbbb');
  const [snapshots, setSnapshots] = useState([]);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const nextId = useRef(6);

  const current = snapshots[step] || null;

  const resetRun = useCallback(() => {
    setSnapshots([]);
    setStep(0);
    setError('');
    setIsRunning(false);
  }, []);

  const decoratedNodes = useMemo(() => {
    const pathNodes = new Set(current?.bestPath?.nodes || []);

    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        label: node.id,
        C: current ? current.C[node.id] : node.data.C,
        Cnext: current ? current.Cnext[node.id] : node.data.Cnext,
        active: Boolean(current && current.activeNode === node.id),
        changed: Boolean(current && current.changedNodes.includes(node.id)),
        onBestPath: pathNodes.has(node.id),
      },
    }));
  }, [nodes, current]);

  const decoratedEdges = useMemo(() => {
    const bestPathEdgeIds = new Set();

    for (const pathEdge of current?.bestPath?.edges || []) {
      const matchingEdge = edges.find(
        (edge) => edge.source === pathEdge.source && edge.target === pathEdge.target,
      );
      if (matchingEdge) bestPathEdgeIds.add(matchingEdge.id);
    }

    const activeEdgeId = current?.activeEdge
      ? edges.find(
        (edge) => edge.source === current.activeEdge.source && edge.target === current.activeEdge.target,
      )?.id
      : null;

    return edges.map((edge) => {
      const isPathEdge = bestPathEdgeIds.has(edge.id);
      const isActiveEdge = edge.id === activeEdgeId;

      let color = '#526275';
      let strokeWidth = 2;

      if (isPathEdge) {
        color = '#7c3aed';
        strokeWidth = 5;
      }

      if (isActiveEdge) {
        color = '#e11d48';
        strokeWidth = 4;
      }

      return {
        ...edge,
        className: '',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth,
          strokeDasharray: 'none',
          opacity: 1,
        },
      };
    });
  }, [edges, current]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const onConnect = useCallback((connection) => {
    setEdges((oldEdges) => addEdge({
      ...connection,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, oldEdges));
    resetRun();
  }, [setEdges, resetRun]);

  const onNodeClick = useCallback((_, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const runAlgorithm = useCallback(() => {
    const result = createRun(nodes, edges, pattern);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError('');
    setSnapshots(result.snapshots);
    setStep(0);
    setIsRunning(false);
  }, [nodes, edges, pattern]);

  const addNode = () => {
    const id = String(nextId.current);
    nextId.current += 1;

    setNodes((oldNodes) => [
      ...oldNodes,
      {
        id,
        type: 'textNode',
        position: {
          x: 130 + (oldNodes.length % 4) * 145,
          y: 100 + Math.floor(oldNodes.length / 4) * 150,
        },
        data: { char: 'a', C: 0, Cnext: null },
      },
    ]);
    setSelectedNodeId(id);
    resetRun();
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((oldNodes) => oldNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((oldEdges) => oldEdges.filter(
      (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
    ));
    setSelectedNodeId(null);
    resetRun();
  };

  const updateSelectedChar = (value) => {
    if (!selectedNodeId) return;
    const char = value.slice(-1);
    setNodes((oldNodes) => oldNodes.map((node) => (
      node.id === selectedNodeId
        ? { ...node, data: { ...node.data, char } }
        : node
    )));
    resetRun();
  };

  const deleteSelectedEdges = () => {
    setEdges((oldEdges) => oldEdges.filter((edge) => !edge.selected));
    resetRun();
  };

  const loadExample = () => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setPattern('bbbb');
    nextId.current = 6;
    setSelectedNodeId(null);
    resetRun();
  };

  const exportGraph = () => {
    const payload = JSON.stringify({ nodes, edges, pattern }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'grafo-navarro.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importGraph = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error('Formato inválido');
        }

        const importedNodes = data.nodes.map((node) => ({
          ...node,
          type: 'textNode',
          data: {
            char: node.data?.char || 'a',
            C: 0,
            Cnext: null,
          },
        }));

        setNodes(importedNodes);
        setEdges(data.edges.map((edge) => ({
          ...edge,
          markerEnd: { type: MarkerType.ArrowClosed },
        })));
        setPattern(typeof data.pattern === 'string' ? data.pattern : '');

        const numericIds = importedNodes.map((node) => Number(node.id)).filter(Number.isFinite);
        nextId.current = numericIds.length ? Math.max(...numericIds) + 1 : importedNodes.length + 1;
        setSelectedNodeId(null);
        resetRun();
      } catch {
        setError('Não foi possível importar o arquivo JSON.');
      }
    };

    reader.readAsText(file);
    event.target.value = '';
  };

  useEffect(() => {
    if (!isRunning || !snapshots.length) return undefined;

    const timer = window.setInterval(() => {
      setStep((oldStep) => {
        if (oldStep >= snapshots.length - 1) {
          setIsRunning(false);
          return oldStep;
        }
        return oldStep + 1;
      });
    }, 650);

    return () => window.clearInterval(timer);
  }, [isRunning, snapshots.length]);

  const pseudocode = [
    ['1', 'para todo v ∈ V: C[v] ← 0'],
    ['2', 'para i = 1 até m'],
    ['3', 'para todo v ∈ V: C′[v] ← g(v, i)'],
    ['4', 'para todo v ∈ V: C[v] ← C′[v]'],
    ['5', 'para toda aresta (u, v) ∈ E: Propagate(u, v)'],
    ['P1', 'se C[v] > 1 + C[u]'],
    ['P2–P4', 'C[v] ← 1 + C[u]; propagar pelas saídas de v'],
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Visualizador do Algoritmo de Navarro</h1>
          <p>Casamento aproximado de padrão em grafo de texto, com propagação de inserções.</p>
        </div>
        <div className="header-badge">React Flow + JavaScript</div>
      </header>

      <main className="layout">
        <aside className="sidebar controls-panel">
          <h2>1. Monte o grafo</h2>
          <p className="help-text">
            Arraste os vértices. Para criar uma aresta, arraste da alça direita de um nó até a alça esquerda de outro.
          </p>

          <div className="button-grid">
            <button onClick={addNode}>+ Vértice</button>
            <button onClick={removeSelectedNode} disabled={!selectedNodeId}>Remover vértice</button>
            <button onClick={deleteSelectedEdges}>Remover arestas selecionadas</button>
            <button onClick={loadExample}>Carregar exemplo</button>
          </div>

          <label className="field-label" htmlFor="pattern">Padrão</label>
          <input
            id="pattern"
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value);
              resetRun();
            }}
            placeholder="Ex.: bbbb"
            spellCheck="false"
          />

          <h3>Vértice selecionado</h3>
          {selectedNode ? (
            <>
              <div className="selection-card">v{selectedNode.id}</div>
              <label className="field-label" htmlFor="vertex-char">Caractere do vértice</label>
              <input
                id="vertex-char"
                value={selectedNode.data.char || ''}
                maxLength={1}
                onChange={(event) => updateSelectedChar(event.target.value)}
                placeholder="a"
              />
            </>
          ) : (
            <p className="muted">Clique em um vértice para trocar sua letra.</p>
          )}

          <div className="file-actions">
            <button onClick={exportGraph}>Exportar JSON</button>
            <label className="import-label">
              Importar JSON
              <input type="file" accept="application/json" onChange={importGraph} />
            </label>
          </div>
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={decoratedNodes}
            edges={decoratedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              resetRun();
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              resetRun();
            }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.3}
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          >
            <Background gap={20} size={1} />
            <Controls />
            <MiniMap nodeColor="#155e75" />
          </ReactFlow>

          <div className="canvas-caption">
            Cada vértice armazena um único caractere. O visualizador executa a versão de Navarro para grafos cíclicos e acíclicos.
          </div>
        </section>

        <aside className="sidebar execution-panel">
          <h2>2. Execute passo a passo</h2>

          <div className="execution-buttons">
            <button className="primary" onClick={runAlgorithm}>Gerar execução</button>
            <button
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={!snapshots.length || step === 0}
            >
              ← Anterior
            </button>
            <button
              onClick={() => setStep((value) => Math.min(snapshots.length - 1, value + 1))}
              disabled={!snapshots.length || step >= snapshots.length - 1}
            >
              Próximo →
            </button>
            <button
              onClick={() => setIsRunning((value) => !value)}
              disabled={!snapshots.length || step >= snapshots.length - 1}
            >
              {isRunning ? 'Pausar' : 'Animar'}
            </button>
            <button onClick={resetRun}>Limpar execução</button>
          </div>

          {error && <div className="error-box">{error}</div>}

          <div className="progress">
            <span>Passo {snapshots.length ? step + 1 : 0} de {snapshots.length}</span>
            <input
              type="range"
              min="0"
              max={Math.max(0, snapshots.length - 1)}
              value={snapshots.length ? step : 0}
              disabled={!snapshots.length}
              onChange={(event) => setStep(Number(event.target.value))}
            />
          </div>

          <div className="status-card">
            <div className="status-meta">
              <span>linha: <strong>{current?.line ?? '—'}</strong></span>
              <span>i: <strong>{current ? current.patternIndex + 1 : '—'}</strong></span>
              <span>patt[i]: <strong>{current?.patternChar || '—'}</strong></span>
            </div>
            <p>{current?.message || 'Clique em “Gerar execução” para calcular os estados.'}</p>
          </div>

          {current?.bestPath?.nodes?.length > 0 && (
            <div className="best-path-box">
              <strong>Caminho destacado</strong>
              <div>{current.bestPath.nodes.map((id) => `v${id}`).join(' → ')}</div>
              <div>Distância de edição: {displayValue(current.bestPath.distance)}</div>
            </div>
          )}

          <h3>Pseudocódigo</h3>
          <ol className="pseudocode">
            {pseudocode.map(([line, text]) => (
              <li key={line} className={String(current?.line) === line ? 'active-line' : ''}>
                <span className="line-no">{line}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>

          <h3>Fila de propagação</h3>
          <div className="queue-box">
            {current?.queue?.length ? (
              current.queue.slice(0, 12).map((edge, index) => (
                <span className="queue-item" key={`${edge.source}-${edge.target}-${index}`}>
                  {edge.source}→{edge.target}
                </span>
              ))
            ) : (
              <span className="muted">Vazia</span>
            )}
          </div>

          <h3>Valores atuais</h3>
          <table>
            <thead>
              <tr>
                <th>v</th>
                <th>t[v]</th>
                <th>C[v]</th>
                <th>C′[v]</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id} className={current?.changedNodes.includes(node.id) ? 'changed-row' : ''}>
                  <td>{node.id}</td>
                  <td>{node.data.char || '?'}</td>
                  <td>{displayValue(current?.C[node.id] ?? node.data.C)}</td>
                  <td>{displayValue(current?.Cnext[node.id] ?? node.data.Cnext)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>
      </main>
    </div>
  );
}

export default App;
