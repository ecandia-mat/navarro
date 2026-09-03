import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'e2-3',
    source: '2',
    target: '3',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'e3-4',
    source: '3',
    target: '4',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'e4-2',
    source: '4',
    target: '2',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: 'e2-5',
    source: '2',
    target: '5',
    markerEnd: { type: MarkerType.ArrowClosed },
  },
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
    edgeIds: [...(path?.edgeIds || [])],
    end: path?.end ?? null,
    distance: path?.distance ?? INF,
    alignment: path?.alignment
      ? {
          patternSeq: path.alignment.patternSeq,
          textSeq: path.alignment.textSeq,
          opsSeq: path.alignment.opsSeq,
          steps: [...path.alignment.steps],
        }
      : null,
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
  bestPath = { nodes: [], edgeIds: [], end: null, distance: INF },
  activeNode = null,
  activeEdgeId = null,
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
    activeEdgeId,
    changedNodes: [...changedNodes],
    queue: queue.map((edge) => ({ ...edge })),
  };
}

function predecessorEdges(nodeId, edges) {
  return edges.filter((edge) => edge.target === nodeId);
}

function outgoingEdges(nodeId, edges) {
  return edges.filter((edge) => edge.source === nodeId);
}

function stateKey(patternIndex, nodeId) {
  return `${patternIndex}|${nodeId}`;
}

/**
 * Reconstrói uma única caminhada + alinhamento completo
 * para um vértice terminal end, usando o mapa de ponteiros.
 */
function reconstructOnePath(end, finalIndex, back, chars, pattern, C) {
  if (C[end] >= INF) {
    return {
      nodes: [],
      edgeIds: [],
      end,
      distance: C[end],
      alignment: null,
    };
  }

  const reversedNodes = [];
  const reversedEdgeIds = [];
  const reversedSteps = [];
  const visitedStates = new Set();

  let i = finalIndex;
  let v = end;

  while (i >= 0 && v !== null && v !== undefined) {
    const key = stateKey(i, v);
    if (visitedStates.has(key)) break;
    visitedStates.add(key);

    const pointer = back.get(key);
    if (!pointer) break;

    const patternChar = i >= 0 ? pattern[i] : '—';
    const textChar = chars[v];

    if (pointer.kind === 'start') {
      reversedNodes.push(v);
      for (let k = i; k >= 0; k -= 1) {
        reversedSteps.push({
          patternChar: pattern[k],
          textChar: '—',
          op: 'D',
        });
      }
      break;
    }

    if (pointer.kind === 'match') {
      reversedSteps.push({
        patternChar,
        textChar,
        op: '=',
      });
      reversedNodes.push(v);
      if (pointer.edgeId) reversedEdgeIds.push(pointer.edgeId);
      i = pointer.prevIndex;
      v = pointer.prevNode;
      continue;
    }

    if (pointer.kind === 'substitute') {
      reversedSteps.push({
        patternChar,
        textChar,
        op: 'X',
      });
      reversedNodes.push(v);
      if (pointer.edgeId) reversedEdgeIds.push(pointer.edgeId);
      i = pointer.prevIndex;
      v = pointer.prevNode;
      continue;
    }

    if (pointer.kind === 'delete-pattern-char') {
      reversedSteps.push({
        patternChar,
        textChar: '—',
        op: 'D',
      });
      i = pointer.prevIndex;
      v = pointer.prevNode;
      continue;
    }

    if (pointer.kind === 'insert-text-char') {
      reversedSteps.push({
        patternChar: '—',
        textChar,
        op: 'I',
      });
      reversedNodes.push(v);
      if (pointer.edgeId) reversedEdgeIds.push(pointer.edgeId);
      i = pointer.prevIndex;
      v = pointer.prevNode;
      continue;
    }

    break;
  }

  for (let k = i; k >= 0; k -= 1) {
    reversedSteps.push({
      patternChar: pattern[k],
      textChar: '—',
      op: 'D',
    });
  }

  const nodes = reversedNodes.reverse();
  const edgeIds = reversedEdgeIds.reverse();
  const steps = reversedSteps.reverse();

  const patternSeq = steps.map((s) => s.patternChar).join('');
  const textSeq = steps.map((s) => s.textChar).join('');
  const opsSeq = steps.map((s) => s.op).join('');

  return {
    nodes,
    edgeIds,
    end,
    distance: C[end],
    alignment: {
      steps,
      patternSeq,
      textSeq,
      opsSeq,
    },
  };
}

/**
 * Todos os caminhos de menor custo, com alinhamento completo.
 */
function reconstructAllPaths(C, finalIndex, back, chars, pattern) {
  const candidates = Object.entries(C).filter(([, value]) => value < INF);
  if (!candidates.length) {
    return [];
  }

  const minDist = Math.min(...candidates.map(([, cost]) => cost));
  const ends = candidates
    .filter(([, cost]) => cost === minDist)
    .map(([id]) => id);

  const paths = [];
  const seenKeys = new Set();

  for (const end of ends) {
    const path = reconstructOnePath(end, finalIndex, back, chars, pattern, C);
    if (!path.nodes.length) continue;

    const key = `${path.nodes.join(',')}|${path.edgeIds.join(',')}`;
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    paths.push(path);
  }

  return paths;
}

/**
 * Algoritmo de Navarro + reconstrução de todos os caminhos mínimos.
 */
function createRun(nodes, edges, pattern) {
  const cleanPattern = pattern.trim();

  if (!cleanPattern) {
    return { error: 'Informe um padrão não vazio.', snapshots: [], paths: [] };
  }
  if (!nodes.length) {
    return { error: 'Crie pelo menos um vértice.', snapshots: [], paths: [] };
  }

  const chars = Object.fromEntries(
    nodes.map((node) => [node.id, node.data.char || '?']),
  );
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
      edgeId: null,
      operation: 'inicialização',
    });
  }

  snapshots.push(
    makeSnapshot({
      kind: 'init',
      line: 1,
      message: 'Inicialização: C[v] ← 0 para todo vértice v.',
      patternIndex: -1,
      patternChar: '',
      C,
      Cnext,
    }),
  );

  for (let i = 0; i < cleanPattern.length; i += 1) {
    const p = cleanPattern[i];

    Cnext = Object.fromEntries(ids.map((id) => [id, null]));
    const choices = Object.fromEntries(ids.map((id) => [id, null]));

    snapshots.push(
      makeSnapshot({
        kind: 'iteration',
        line: 2,
        message: `Início da iteração i = ${i + 1}: processando patt[${i + 1}] = “${p}”.`,
        patternIndex: i,
        patternChar: p,
        C,
        Cnext,
      }),
    );

    for (const id of ids) {
      const incoming = predecessorEdges(id, edges);

      const bestIncoming = incoming.reduce(
        (best, edge) =>
          C[edge.source] < best.cost
            ? { edge, cost: C[edge.source] }
            : best,
        { edge: null, cost: INF },
      );

      if (chars[id] === p) {
        const startCost = i;

        if (bestIncoming.cost <= startCost && bestIncoming.edge) {
          Cnext[id] = bestIncoming.cost;
          choices[id] = {
            kind: 'match',
            prevIndex: i - 1,
            prevNode: bestIncoming.edge.source,
            edgeId: bestIncoming.edge.id,
            operation: 'casamento',
          };
        } else {
          Cnext[id] = startCost;
          choices[id] = {
            kind: 'start',
            prevIndex: null,
            prevNode: null,
            edgeId: null,
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
            edgeId: null,
            operation: 'deleção no padrão',
          },
          ...incoming.map((edge) => ({
            cost: C[edge.source],
            kind: 'substitute',
            prevIndex: i - 1,
            prevNode: edge.source,
            edgeId: edge.id,
            operation: 'substituição',
          })),
        ];

        const best = alternatives.reduce(
          (currentBest, candidate) =>
            candidate.cost < currentBest.cost ? candidate : currentBest,
          {
            cost: INF,
            kind: 'none',
            prevIndex: null,
            prevNode: null,
            edgeId: null,
            operation: 'nenhuma',
          },
        );

        Cnext[id] = best.cost >= INF ? INF : best.cost + 1;
        choices[id] = best;
      }

      const choice = choices[id];
      const origin =
        choice.prevNode === null
          ? 'início de um novo sufixo'
          : `v${choice.prevNode}`;

      const formula =
        chars[id] === p
          ? `t[${id}] = “${chars[id]}” coincide com patt[${i + 1}] = “${p}”. C′[${id}] = ${displayValue(
              Cnext[id],
            )}; origem: ${origin}.`
          : `t[${id}] = “${chars[id]}” difere de patt[${i + 1}] = “${p}”. C′[${id}] = ${displayValue(
              Cnext[id],
            )}; operação: ${choice.operation}; origem: ${origin}.`;

      snapshots.push(
        makeSnapshot({
          kind: 'compute',
          line: 3,
          message: formula,
          patternIndex: i,
          patternChar: p,
          C,
          Cnext,
          activeNode: id,
        }),
      );
    }

    C = cloneMap(Cnext);

    for (const id of ids) {
      const choice = choices[id];
      back.set(stateKey(i, id), {
        kind: choice.kind,
        prevIndex: choice.prevIndex,
        prevNode: choice.prevNode,
        edgeId: choice.edgeId,
        operation: choice.operation,
      });
    }

    snapshots.push(
      makeSnapshot({
        kind: 'copy',
        line: 4,
        message: 'Linha 4: C[v] ← C′[v] para todos os vértices.',
        patternIndex: i,
        patternChar: p,
        C,
        Cnext,
      }),
    );

    const queue = edges.map((edge) => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
    }));
    let cursor = 0;

    snapshots.push(
      makeSnapshot({
        kind: 'propagation-start',
        line: 5,
        message: `Início da propagação: ${queue.length} aresta(s) serão examinadas inicialmente.`,
        patternIndex: i,
        patternChar: p,
        C,
        Cnext,
        queue,
      }),
    );

    while (cursor < queue.length) {
      const currentEdge = queue[cursor];
      cursor += 1;

      const { edgeId, source, target } = currentEdge;
      const oldValue = C[target];
      const candidate = C[source] >= INF ? INF : C[source] + 1;
      const remaining = queue.slice(cursor);

      snapshots.push(
        makeSnapshot({
          kind: 'propagate-test',
          line: 'P1',
          message: `Propagate(${source}, ${target}): testar C[${target}] > 1 + C[${source}]. Temos ${displayValue(
            oldValue,
          )} > ${displayValue(candidate)}?`,
          patternIndex: i,
          patternChar: p,
          C,
          Cnext,
          activeEdgeId: edgeId,
          queue: remaining,
        }),
      );

      if (oldValue > candidate) {
        C[target] = candidate;
        back.set(stateKey(i, target), {
          kind: 'insert-text-char',
          prevIndex: i,
          prevNode: source,
          edgeId,
          operation: 'inserção no texto',
        });

        const outgoing = outgoingEdges(target, edges).map((edge) => ({
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
        }));
        queue.push(...outgoing);

        snapshots.push(
          makeSnapshot({
            kind: 'propagate-update',
            line: 'P2–P4',
            message: `Atualização: C[${target}] ← ${displayValue(
              candidate,
            )}. A origem passa a ser v${source}, por inserção no texto. ${
              outgoing.length
            } aresta(s) de saída de v${target} entram na fila.`,
            patternIndex: i,
            patternChar: p,
            C,
            Cnext,
            activeNode: target,
            activeEdgeId: edgeId,
            changedNodes: [target],
            queue: queue.slice(cursor),
          }),
        );
      } else {
        snapshots.push(
          makeSnapshot({
            kind: 'propagate-nochange',
            line: 'P1',
            message: `Nenhuma atualização em v${target}: a condição é falsa.`,
            patternIndex: i,
            patternChar: p,
            C,
            Cnext,
            activeEdgeId: edgeId,
            queue: remaining,
          }),
        );
      }
    }

    Cnext = cloneMap(C);

    snapshots.push(
      makeSnapshot({
        kind: 'iteration-done',
        line: 5,
        message: `Fim da iteração i = ${
          i + 1
        }. Os valores C incorporam todas as inserções propagadas.`,
        patternIndex: i,
        patternChar: p,
        C,
        Cnext,
      }),
    );
  }

  const paths = reconstructAllPaths(
    C,
    cleanPattern.length - 1,
    back,
    chars,
    cleanPattern,
  );
  const bestPath = paths[0] || {
    nodes: [],
    edgeIds: [],
    end: null,
    distance: INF,
    alignment: null,
  };

  const pathText = bestPath.nodes.length
    ? bestPath.nodes.map((id) => `v${id}`).join(' → ')
    : 'nenhum';

  snapshots.push(
    makeSnapshot({
      kind: 'done',
      line: 'fim',
      message: `Execução concluída. Caminhadas de menor custo reconstruídas. Um exemplo: ${pathText}. Distância final mínima: ${displayValue(
        bestPath.distance,
      )}.`,
      patternIndex: cleanPattern.length - 1,
      patternChar: cleanPattern.at(-1),
      C,
      Cnext,
      bestPath,
    }),
  );

  return { error: null, snapshots, paths };
}

function TextNode({ data, selected }) {
  const className = [
    'text-node',
    selected ? 'selected-node' : '',
    data.active ? 'active-node' : '',
    data.changed ? 'changed-node' : '',
    data.onBestPath ? 'best-path-node' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <div className="node-id">v{data.label}</div>
      <div className="node-char">{data.char}</div>
      <div className="node-values">
        <span>C: {displayValue(data.C)}</span>
        <span>C′: {displayValue(data.Cnext)}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        style={{ background: '#0f766e' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        style={{ background: '#0f766e' }}
      />
    </div>
  );
}

const nodeTypes = {
  textNode: TextNode,
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const [pattern, setPattern] = useState('bbbb');
  const [snapshots, setSnapshots] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paths, setPaths] = useState([]);
  const [selectedPathIndex, setSelectedPathIndex] = useState(-1);
  const [error, setError] = useState(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef(null);

  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const current = snapshots[currentIndex] || null;
  const totalSteps = snapshots.length;

  const selectedPath =
    paths.length &&
    selectedPathIndex >= 0 &&
    selectedPathIndex < paths.length
      ? paths[selectedPathIndex]
      : null;

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const onBestPath = selectedPath
          ? selectedPath.nodes.includes(node.id)
          : false;

        return {
          ...node,
          data: {
            ...node.data,
            label: node.id,
            C: current ? current.C[node.id] ?? node.data.C : node.data.C,
            Cnext: current
              ? current.Cnext[node.id] ?? node.data.Cnext
              : node.data.Cnext,
            active: current ? current.activeNode === node.id : false,
            changed: current
              ? current.changedNodes?.includes(node.id) ?? false
              : false,
            onBestPath,
          },
        };
      }),
    [nodes, current, selectedPath],
  );

  const decoratedEdges = useMemo(() => {
    const pathEdgeIds = new Set(selectedPath?.edgeIds || []);
    const activeEdgeId = current?.activeEdgeId ?? null;

    return edges.map((edge) => {
      const isPathEdge = pathEdgeIds.has(edge.id);
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
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
        },
        style: {
          stroke: color,
          strokeWidth,
          strokeDasharray: 'none',
          opacity: 1,
        },
      };
    });
  }, [edges, current, selectedPath]);

  const handleConnect = useCallback(
    (connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const handleNodeClick = useCallback((_, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const updateSelectedChar = useCallback(
    (value) => {
      if (!selectedNodeId) return;
      const char = value.slice(-1); // último caractere digitado

      setNodes((oldNodes) =>
        oldNodes.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  char: char || node.data.char,
                },
              }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const handleAddNode = useCallback(() => {
    const maxId =
      nodes.length === 0
        ? 0
        : Math.max(...nodes.map((n) => Number(n.id) || 0));
    const newId = String(maxId + 1);

    const newNode = {
      id: newId,
      type: 'textNode',
      position: {
        x: 100 + 40 * nodes.length,
        y: 200 + 10 * nodes.length,
      },
      data: { char: 'b', C: 0, Cnext: null },
    };

    setNodes((nds) => [...nds, newNode]);
  }, [nodes, setNodes]);

  const handleReset = useCallback(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSnapshots([]);
    setPaths([]);
    setSelectedPathIndex(-1);
    setCurrentIndex(0);
    setSelectedNodeId(null);
    setError(null);
    setIsPlaying(false);
    if (playRef.current) clearInterval(playRef.current);
  }, []);

  const handleRun = useCallback(() => {
    const { error: runError, snapshots: runSnapshots, paths: runPaths } =
      createRun(nodes, edges, pattern);

    if (runError) {
      setError(runError);
      setSnapshots([]);
      setPaths([]);
      setSelectedPathIndex(-1);
      setCurrentIndex(0);
      return;
    }

    setError(null);
    setSnapshots(runSnapshots);
    setPaths(runPaths);
    setSelectedPathIndex(-1);
    setCurrentIndex(0);
  }, [nodes, edges, pattern]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((idx) =>
      totalSteps === 0 ? 0 : Math.min(totalSteps - 1, idx + 1),
    );
  }, [totalSteps]);

  const handlePlayStop = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (playRef.current) clearInterval(playRef.current);
      return;
    }

    if (!snapshots.length) return;

    setIsPlaying(true);
    playRef.current = setInterval(() => {
      setCurrentIndex((idx) => {
        const next = idx + 1;
        if (next >= snapshots.length) {
          setIsPlaying(false);
          if (playRef.current) clearInterval(playRef.current);
          return idx;
        }
        return next;
      });
    }, 800);
  }, [isPlaying, snapshots.length]);

  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  const handlePathSelect = useCallback((event) => {
    const value = Number(event.target.value);
    setSelectedPathIndex(Number.isNaN(value) ? -1 : value);
  }, []);

  const handleExportJSON = useCallback(() => {
    const data = {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: { char: node.data.char || 'b' },
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
      pattern,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'grafo-navarro.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [nodes, edges, pattern]);

  const handleImportJSON = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const importedNodes = (data.nodes || []).map((node) => ({
            id: node.id,
            type: node.type || 'textNode',
            position: node.position || { x: 0, y: 0 },
            data: {
              char: node.data?.char || 'b',
              C: 0,
              Cnext: null,
            },
          }));
          const importedEdges = (data.edges || []).map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            markerEnd: { type: MarkerType.ArrowClosed },
          }));

          setNodes(importedNodes);
          setEdges(importedEdges);
          if (typeof data.pattern === 'string') {
            setPattern(data.pattern);
          }

          setSnapshots([]);
          setPaths([]);
          setSelectedPathIndex(-1);
          setCurrentIndex(0);
          setSelectedNodeId(null);
          setError(null);
        } catch (err) {
          setError('Falha ao importar JSON: ' + String(err));
        }
      };
      reader.readAsText(file);
    },
    [setNodes, setEdges],
  );

  const currentLine = current?.line ?? '';
  const currentMessage = current?.message ?? '';
  const currentPatternIndex = current?.patternIndex ?? -1;
  const currentPatternChar = current?.patternChar ?? '';

  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId) || null
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Visualizador do algoritmo de Navarro</h1>
          <p>
            Execução passo a passo do casamento aproximado de padrão em grafos
            direcionados.
          </p>
        </div>
        <div className="header-badge">
          Distância de edição em grafos com propagação de inserções.
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar controls-panel">
          <h2>Configuração</h2>
          <p className="help-text">
            Edite o padrão abaixo e os caracteres em cada vértice. Crie nós e
            arestas para montar o grafo em que o padrão será buscado.
          </p>

          <label className="field-label" htmlFor="pattern">
            Padrão (patt)
          </label>
          <input
            id="pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />

          <div className="button-grid">
            <button type="button" onClick={handleAddNode}>
              Adicionar vértice
            </button>
            <label className="import-label">
              Importar JSON
              <input
                type="file"
                accept="application/json"
                onChange={handleImportJSON}
              />
            </label>
          </div>

          <div className="execution-buttons">
            <button
              type="button"
              className="primary"
              onClick={handleRun}
              disabled={!nodes.length}
            >
              Gerar execução
            </button>
            <button type="button" onClick={handleReset}>
              Reiniciar
            </button>
            <button type="button" onClick={handleExportJSON}>
              Exportar JSON
            </button>
          </div>

          <h3>Vértice selecionado</h3>
          {selectedNode ? (
            <div className="selection-card">
              <div>v{selectedNodeId}</div>

              <label className="field-label" htmlFor="vertex-char">
                Caractere do vértice
              </label>
              <input
                id="vertex-char"
                type="text"
                maxLength={1}
                value={selectedNode.data.char || ''}
                onChange={(event) => updateSelectedChar(event.target.value)}
                placeholder="a"
              />

              <p className="muted">
                Clique em um vértice no grafo para trocar sua letra.
              </p>
            </div>
          ) : (
            <p className="muted">
              Clique em um vértice no grafo para editar o caractere.
            </p>
          )}

          <h3>Controle de animação</h3>
          <div className="progress">
            <span>
              Passo {totalSteps === 0 ? 0 : currentIndex + 1} de {totalSteps}.
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, totalSteps - 1)}
              value={currentIndex}
              onChange={(e) => setCurrentIndex(Number(e.target.value))}
            />
          </div>

          <div className="execution-buttons">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!snapshots.length}
            >
              Passo anterior
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!snapshots.length}
            >
              Próximo passo
            </button>
            <button
              type="button"
              className="primary"
              onClick={handlePlayStop}
              disabled={!snapshots.length}
            >
              {isPlaying ? 'Parar animação' : 'Reproduzir animação'}
            </button>
          </div>

          <div className="file-actions">
            <span className="muted">
              Para importar um grafo grande, use o formato JSON exportado e
              escolha o arquivo.
            </span>
          </div>
        </aside>

        <main className="canvas-panel">
          <ReactFlowProvider>
            <ReactFlow
              nodes={decoratedNodes}
              edges={decoratedEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={handleConnect}
              onNodeClick={handleNodeClick}
              fitView
            >
              <MiniMap />
              <Controls />
              <Background gap={18} size={1} />
            </ReactFlow>
          </ReactFlowProvider>

          <div className="canvas-caption">
            Edite o grafo com o mouse: arraste vértices, crie arestas ligando o
            handle de saída ao handle de entrada, altere o caractere de cada
            vértice clicando e editando no inspetor lateral.
          </div>
        </main>

        <aside className="sidebar status-panel">
          <h2>Estado da execução</h2>

          <div className="status-card">
            <strong>Linha ativa do pseudocódigo</strong>
            <p>
              {typeof currentLine === 'string'
                ? `Linha ${currentLine}`
                : `Linha ${String(currentLine)}`}
            </p>
            <p>{currentMessage}</p>

            <div className="status-meta">
              <span>
                i ={' '}
                {currentPatternIndex < 0
                  ? '—'
                  : String(currentPatternIndex + 1)}
              </span>
              <span>
                patt[i] ={' '}
                {currentPatternChar ? `“${currentPatternChar}”` : '—'}
              </span>
            </div>
          </div>

          {paths.length > 0 && (
            <div className="best-path-box">
              <strong>Caminhos de menor distância</strong>
              <div className="best-path-select">
                <label htmlFor="pathSelect">Escolha o caminho:</label>
                <select
                  id="pathSelect"
                  value={selectedPathIndex}
                  onChange={handlePathSelect}
                >
                  {/* opção vazia / nenhum caminho selecionado */}
                  <option value={-1}>Nenhum (não destacar)</option>

                  {paths.map((path, idx) => (
                    <option key={idx} value={idx}>
                      #{idx + 1}:{' '}
                      {path.nodes.map((id) => `v${id}`).join(' → ')}
                    </option>
                  ))}
                </select>
              </div>

              {selectedPath && (
                <div>
                  Distância de edição desse caminho:{' '}
                  {displayValue(selectedPath.distance)}
                </div>
              )}
            </div>
          )}

          {selectedPath?.alignment && (
            <div className="alignment-box">
              <strong>Comparação padrão ↔ caminho selecionado</strong>
              <div className="alignment-line">
                <span className="alignment-label">Padrão</span>
                <span className="alignment-seq">
                  {selectedPath.alignment.steps.map((step, idx) => (
                    <span
                      key={`p-${idx}`}
                      className={`align-op align-op-${step.op}`}
                    >
                      {step.patternChar === '—' ? '∅' : step.patternChar}
                    </span>
                  ))}
                </span>
              </div>
              <div className="alignment-line">
                <span className="alignment-label">Texto</span>
                <span className="alignment-seq">
                  {selectedPath.alignment.steps.map((step, idx) => (
                    <span
                      key={`t-${idx}`}
                      className={`align-op align-op-${step.op}`}
                    >
                      {step.textChar === '—' ? '∅' : step.textChar}
                    </span>
                  ))}
                </span>
              </div>
              <div className="alignment-line">
                <span className="alignment-label">Operações</span>
                <span className="alignment-seq">
                  {selectedPath.alignment.steps.map((step, idx) => (
                    <span
                      key={`o-${idx}`}
                      className={`align-op align-op-${step.op}`}
                    >
                      {step.op}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          <h3>Pseudocódigo</h3>
          <ul className="pseudocode">
            <li className={currentLine === 1 ? 'active-line' : ''}>
              <span>1</span>
              <span>Inicializar C[v] ← 0 para todo v ∈ V.</span>
            </li>
            <li className={currentLine === 2 ? 'active-line' : ''}>
              <span>2</span>
              <span>
                Para i = 1..m, processar patt[i] e calcular C′[v] para todo v.
              </span>
            </li>
            <li className={currentLine === 3 ? 'active-line' : ''}>
              <span>3</span>
              <span>
                Calcular C′[v] considerando casamento, substituição, deleção no
                padrão.
              </span>
            </li>
            <li className={currentLine === 4 ? 'active-line' : ''}>
              <span>4</span>
              <span>C[v] ← C′[v] para todo v.</span>
            </li>
            <li className={currentLine === 5 ? 'active-line' : ''}>
              <span>5</span>
              <span>
                Propagar inserções no texto: enquanto houver aresta (u, v) com
                C[v] &gt; 1 + C[u], atualizar C[v].
              </span>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default App;