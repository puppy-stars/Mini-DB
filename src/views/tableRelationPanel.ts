import * as vscode from 'vscode';
import { ForeignKeyRelation, TableColumn } from '../models/types';
import { i18n } from '../i18n';

interface TableNode {
  name: string;
  columns: TableColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RelationEdge {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  constraintName: string;
}

export class TableRelationPanel {
  public static currentPanel: TableRelationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static render(
    extensionUri: vscode.Uri,
    database: string,
    tables: { name: string; columns: TableColumn[] }[],
    foreignKeys: ForeignKeyRelation[]
  ) {
    const s = i18n.strings;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TableRelationPanel.currentPanel) {
      TableRelationPanel.currentPanel._panel.reveal(column);
      TableRelationPanel.currentPanel._update(database, tables, foreignKeys);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'tableRelation',
      `${s.relationViewer.title} - ${database}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    TableRelationPanel.currentPanel = new TableRelationPanel(panel, extensionUri);
    TableRelationPanel.currentPanel._update(database, tables, foreignKeys);
  }

  private _update(
    database: string,
    tables: { name: string; columns: TableColumn[] }[],
    foreignKeys: ForeignKeyRelation[]
  ) {
    this._panel.webview.html = this._getHtmlForWebview(database, tables, foreignKeys);
  }

  private _getHtmlForWebview(
    database: string,
    tables: { name: string; columns: TableColumn[] }[],
    foreignKeys: ForeignKeyRelation[]
  ): string {
    const s = i18n.strings;
    const nonce = this._getNonce();

    const tableNodes: TableNode[] = tables.map((table) => {
      const colCount = table.columns.length || 1;
      const height = 40 + colCount * 24;
      return {
        name: table.name,
        columns: table.columns,
        x: 0,
        y: 0,
        width: 200,
        height: height,
      };
    });

    const edges: RelationEdge[] = foreignKeys.map((fk) => ({
      from: fk.fromTable,
      fromColumn: fk.fromColumn,
      to: fk.toTable,
      toColumn: fk.toColumn,
      constraintName: fk.constraintName,
    }));

    const tableNodesJson = JSON.stringify(tableNodes);
    const edgesJson = JSON.stringify(edges);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this._panel.webview.cspSource} data:; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src ${this._panel.webview.cspSource} 'nonce-${nonce}' 'unsafe-inline';">
  <title>${s.relationViewer.title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--vscode-font-family);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
      height: 100vh;
    }
    
    .toolbar {
      display: flex;
      flex-direction: column;
      padding: 8px 16px;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
    }
    
    .toolbar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .toolbar-title {
      font-weight: 600;
      font-size: 14px;
    }
    
    .toolbar-info {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    
    .toolbar-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-editorWidget-border);
    }
    
    .toolbar-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 0;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .toolbar-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .toolbar-btn:active {
      opacity: 0.9;
    }
    
    .canvas-container {
      position: relative;
      width: 100%;
      height: calc(100vh - 95px);
      overflow: hidden;
    }
    
    #canvas {
      position: absolute;
      top: 0;
      left: 0;
      cursor: grab;
    }
    
    #canvas:active {
      cursor: grabbing;
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: calc(100vh - 95px);
      color: var(--vscode-descriptionForeground);
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    
    .empty-state-text {
      font-size: 14px;
    }
    
    .legend {
      position: absolute;
      bottom: 16px;
      right: 16px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
    }
    
    .legend-title {
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    
    .legend-color {
      width: 16px;
      height: 4px;
      border-radius: 2px;
    }
    
    .legend-color.pk {
      background: #f0c040;
    }
    
    .legend-color.fk {
      background: #40a0f0;
    }
    
    .legend-color.relation {
      background: #808080;
    }
    
    .legend-color.selected {
      background: #00ff88;
    }
    
    .edge-info {
      position: absolute;
      top: 60px;
      left: 16px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      display: none;
    }
    
    .edge-info.visible {
      display: block;
    }
    
    .edge-info-title {
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .edge-info-item {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-header">
      <span class="toolbar-title">${s.relationViewer.title}: ${database}</span>
      <span class="toolbar-info" id="tableCount"></span>
    </div>
    <div class="toolbar-actions">
      <button class="toolbar-btn" id="exportBtn">${s.relationViewer.exportImage}</button>
    </div>
  </div>
  <div class="canvas-container">
    <canvas id="canvas"></canvas>
    <div class="legend">
      <div class="legend-title">${s.relationViewer.legend}</div>
      <div class="legend-item">
        <div class="legend-color pk"></div>
        <span>${s.relationViewer.primaryKey}</span>
      </div>
      <div class="legend-item">
        <div class="legend-color fk"></div>
        <span>${s.relationViewer.foreignKey}</span>
      </div>
      <div class="legend-item">
        <div class="legend-color selected"></div>
        <span>${s.relationViewer.selectedRelation || 'Selected Relation'}</span>
      </div>
    </div>
    <div class="edge-info" id="edgeInfo">
      <div class="edge-info-title" id="edgeInfoTitle"></div>
      <div class="edge-info-item" id="edgeInfoFrom"></div>
      <div class="edge-info-item" id="edgeInfoTo"></div>
    </div>
  </div>
  
  <script nonce="${nonce}">
    (function() {
      const tables = ${tableNodesJson};
      const edges = ${edgesJson};
      
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      const container = document.querySelector('.canvas-container');
      const edgeInfo = document.getElementById('edgeInfo');
      const edgeInfoTitle = document.getElementById('edgeInfoTitle');
      const edgeInfoFrom = document.getElementById('edgeInfoFrom');
      const edgeInfoTo = document.getElementById('edgeInfoTo');
      
      let scale = 1;
      let offsetX = 50;
      let offsetY = 50;
      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let selectedTable = null;
      let selectedEdge = null;
      let tablePositions = new Map();
      let edgePaths = [];
      
      const TABLE_WIDTH = 200;
      const HEADER_HEIGHT = 32;
      const ROW_HEIGHT = 24;
      const TABLE_GAP = 100;
      
      const colors = {
        background: getComputedStyle(document.body).getPropertyValue('--vscode-editor-background') || '#1e1e1e',
        foreground: getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground') || '#cccccc',
        border: getComputedStyle(document.body).getPropertyValue('--vscode-editorWidget-border') || '#454545',
        headerBg: getComputedStyle(document.body).getPropertyValue('--vscode-editorGroupHeader-tabsBackground') || '#252526',
        primaryKey: '#f0c040',
        foreignKey: '#40a0f0',
        relation: '#808080',
        selected: '#00ff88',
        selectedBorder: '#00ff88',
        columnHighlight: 'rgba(0, 255, 136, 0.3)'
      };
      
      function init() {
        resizeCanvas();
        layoutTables();
        render();
        bindEvents();
        updateTableCount();
      }
      
      function resizeCanvas() {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
      
      function layoutTables() {
        if (tables.length === 0) return;
        
        const levels = [];
        const visited = new Set();
        const tableMap = new Map();
        tables.forEach(t => {
          tableMap.set(t.name, t);
          tableMap.set(t.name.toLowerCase(), t);
        });
        
        const referencedTables = new Set(edges.map(e => e.to));
        const referencingTables = new Set(edges.map(e => e.from));
        const rootTables = tables.filter(t => !referencedTables.has(t.name) && !referencedTables.has(t.name.toLowerCase()) || !referencingTables.has(t.name));
        
        function getLevel(tableName, level) {
          if (!level) level = 0;
          if (visited.has(tableName) || visited.has(tableName.toLowerCase())) return;
          visited.add(tableName);
          
          if (!levels[level]) levels[level] = [];
          levels[level].push(tableName);
          
          edges
            .filter(e => e.from === tableName || e.from.toLowerCase() === tableName.toLowerCase())
            .forEach(e => getLevel(e.to, level + 1));
        }
        
        rootTables.forEach(t => getLevel(t.name, 0));
        tables.forEach(t => {
          if (!visited.has(t.name) && !visited.has(t.name.toLowerCase())) {
            if (!levels[0]) levels[0] = [];
            levels[0].push(t.name);
          }
        });
        
        let y = 50;
        levels.forEach((level, levelIndex) => {
          let x = 50;
          level.forEach((tableName) => {
            const table = tableMap.get(tableName) || tableMap.get(tableName.toLowerCase());
            if (table) {
              const height = HEADER_HEIGHT + (table.columns.length || 1) * ROW_HEIGHT;
              tablePositions.set(tableName, { x, y, width: TABLE_WIDTH, height });
              tablePositions.set(table.name, { x, y, width: TABLE_WIDTH, height });
              x += TABLE_WIDTH + TABLE_GAP;
            }
          });
          const maxY = Math.max(...level.map(tn => {
            const pos = tablePositions.get(tn);
            return pos ? pos.y + pos.height : 0;
          }));
          y = (maxY || y) + TABLE_GAP;
        });
      }
      
      function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        edgePaths = [];
        drawEdges();
        drawTables();
        
        ctx.restore();
      }
      
      function drawEdges() {
        edges.forEach((edge, edgeIndex) => {
          let fromPos = tablePositions.get(edge.from);
          if (!fromPos) {
            fromPos = tablePositions.get(edge.from.toLowerCase());
          }
          let toPos = tablePositions.get(edge.to);
          if (!toPos) {
            toPos = tablePositions.get(edge.to.toLowerCase());
          }
          
          if (!fromPos || !toPos) return;
          
          let fromTable = tables.find(t => t.name === edge.from);
          if (!fromTable) {
            fromTable = tables.find(t => t.name.toLowerCase() === edge.from.toLowerCase());
          }
          
          let toTable = tables.find(t => t.name === edge.to);
          if (!toTable) {
            toTable = tables.find(t => t.name.toLowerCase() === edge.to.toLowerCase());
          }
          
          let fromColIndex = fromTable?.columns.findIndex(c => c.name === edge.fromColumn) ?? -1;
          if (fromColIndex < 0 && fromTable) {
            fromColIndex = fromTable.columns.findIndex(c => c.name.toLowerCase() === edge.fromColumn.toLowerCase());
          }
          
          let toColIndex = toTable?.columns.findIndex(c => c.name === edge.toColumn) ?? -1;
          if (toColIndex < 0 && toTable) {
            toColIndex = toTable.columns.findIndex(c => c.name.toLowerCase() === edge.toColumn.toLowerCase());
          }
          
          const fromTableHeight = HEADER_HEIGHT + (fromTable?.columns.length || 1) * ROW_HEIGHT;
          const toTableHeight = HEADER_HEIGHT + (toTable?.columns.length || 1) * ROW_HEIGHT;
          
          let startY, endY;
          
          if (fromColIndex >= 0 && fromTable && fromTable.columns.length > 0) {
            startY = fromPos.y + HEADER_HEIGHT + fromColIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
          } else {
            startY = fromPos.y + fromTableHeight / 2;
          }
          
          if (toColIndex >= 0 && toTable && toTable.columns.length > 0) {
            endY = toPos.y + HEADER_HEIGHT + toColIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
          } else {
            endY = toPos.y + toTableHeight / 2;
          }
          
          const startX = fromPos.x + fromPos.width;
          const endX = toPos.x;
          const midX = (startX + endX) / 2;
          
          const isSelected = selectedEdge === edgeIndex;
          
          ctx.beginPath();
          ctx.strokeStyle = isSelected ? colors.selected : colors.relation;
          ctx.lineWidth = isSelected ? 3 : 1.5;
          
          ctx.moveTo(startX, startY);
          ctx.bezierCurveTo(midX, startY, midX, endY, endX, endY);
          ctx.stroke();
          
          if (isSelected) {
            ctx.shadowColor = colors.selected;
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          const arrowSize = 8;
          const angle = Math.atan2(endY - startY, endX - midX);
          ctx.beginPath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.moveTo(endX, endY);
          ctx.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
          
          edgePaths.push({
            index: edgeIndex,
            edge: edge,
            startX, startY, endX, endY, midX,
            fromTable: fromTable?.name,
            toTable: toTable?.name,
            fromColIndex,
            toColIndex
          });
        });
      }
      
      function drawTables() {
        tables.forEach(table => {
          const pos = tablePositions.get(table.name);
          if (!pos) return;
          
          const isTableSelected = selectedTable === table.name;
          const isTableInSelectedEdge = selectedEdge !== null && 
            edgePaths.some(ep => ep.index === selectedEdge && 
              (ep.fromTable === table.name || ep.toTable === table.name));
          
          const height = HEADER_HEIGHT + (table.columns.length || 1) * ROW_HEIGHT;
          
          ctx.fillStyle = colors.headerBg;
          ctx.strokeStyle = isTableInSelectedEdge ? colors.selectedBorder : (isTableSelected ? colors.selected : colors.border);
          ctx.lineWidth = isTableInSelectedEdge ? 3 : (isTableSelected ? 2 : 1);
          
          ctx.beginPath();
          ctx.roundRect(pos.x, pos.y, pos.width, height, 6);
          ctx.fill();
          ctx.stroke();
          
          ctx.fillStyle = colors.foreground;
          ctx.font = 'bold 13px var(--vscode-font-family)';
          ctx.textBaseline = 'middle';
          ctx.fillText(table.name, pos.x + 10, pos.y + HEADER_HEIGHT / 2);
          
          ctx.fillStyle = colors.background;
          ctx.fillRect(pos.x, pos.y + HEADER_HEIGHT, pos.width, height - HEADER_HEIGHT);
          
          ctx.strokeStyle = isTableInSelectedEdge ? colors.selectedBorder : (isTableSelected ? colors.selected : colors.border);
          ctx.lineWidth = isTableInSelectedEdge ? 2 : 1;
          ctx.strokeRect(pos.x, pos.y + HEADER_HEIGHT, pos.width, height - HEADER_HEIGHT);
          
          table.columns.forEach((col, index) => {
            const y = pos.y + HEADER_HEIGHT + index * ROW_HEIGHT;
            
            const isColumnInSelectedEdge = selectedEdge !== null && 
              edgePaths.some(ep => ep.index === selectedEdge && 
                ((ep.fromTable === table.name && ep.fromColIndex === index) ||
                 (ep.toTable === table.name && ep.toColIndex === index)));
            
            if (isColumnInSelectedEdge) {
              ctx.fillStyle = colors.columnHighlight;
              ctx.fillRect(pos.x, y, pos.width, ROW_HEIGHT);
            }
            
            if (col.isPrimaryKey) {
              ctx.fillStyle = colors.primaryKey;
              ctx.fillRect(pos.x + 4, y + 4, 4, ROW_HEIGHT - 8);
            }
            
            const fk = edges.find(e => (e.from === table.name || e.from.toLowerCase() === table.name.toLowerCase()) && 
                                        (e.fromColumn === col.name || e.fromColumn.toLowerCase() === col.name.toLowerCase()));
            if (fk) {
              ctx.fillStyle = colors.foreignKey;
              ctx.fillRect(pos.x + 4, y + 4, 4, ROW_HEIGHT - 8);
            }
            
            ctx.fillStyle = colors.foreground;
            ctx.font = '12px var(--vscode-font-family)';
            ctx.textBaseline = 'middle';
            ctx.fillText(col.name, pos.x + 16, y + ROW_HEIGHT / 2);
            
            ctx.fillStyle = '#888';
            ctx.font = '11px var(--vscode-font-family)';
            const typeText = col.type.length > 15 ? col.type.substring(0, 15) + '...' : col.type;
            ctx.fillText(typeText, pos.x + pos.width - ctx.measureText(typeText).width - 8, y + ROW_HEIGHT / 2);
          });
        });
      }
      
      function isPointNearBezier(px, py, startX, startY, midX, endX, endY, threshold) {
        threshold = threshold || 8;
        for (let t = 0; t <= 1; t += 0.02) {
          const x = Math.pow(1-t, 3) * startX + 3 * Math.pow(1-t, 2) * t * midX + 3 * (1-t) * t * t * midX + Math.pow(t, 3) * endX;
          const y = Math.pow(1-t, 3) * startY + 3 * Math.pow(1-t, 2) * t * startY + 3 * (1-t) * t * t * endY + Math.pow(t, 3) * endY;
          
          const dist = Math.sqrt(Math.pow(px - x, 2) + Math.pow(py - y, 2));
          if (dist < threshold) {
            return true;
          }
        }
        return false;
      }
      
      function showEdgeInfo(edgePath) {
        if (!edgePath) {
          edgeInfo.classList.remove('visible');
          return;
        }
        
        const edge = edgePath.edge;
        edgeInfoTitle.textContent = edge.constraintName || 'FK Relation';
        edgeInfoFrom.textContent = 'From: ' + edgePath.fromTable + '.' + edge.fromColumn;
        edgeInfoTo.textContent = 'To: ' + edgePath.toTable + '.' + edge.toColumn;
        edgeInfo.classList.add('visible');
      }
      
      function bindEvents() {
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
          exportBtn.addEventListener('click', exportImage);
        }
        
        canvas.addEventListener('mousedown', (e) => {
          isDragging = true;
          dragStartX = e.clientX - offsetX;
          dragStartY = e.clientY - offsetY;
        });
        
        canvas.addEventListener('mousemove', (e) => {
          if (isDragging) {
            offsetX = e.clientX - dragStartX;
            offsetY = e.clientY - dragStartY;
            render();
          }
        });
        
        canvas.addEventListener('mouseup', () => {
          isDragging = false;
        });
        
        canvas.addEventListener('mouseleave', () => {
          isDragging = false;
        });
        
        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          const newScale = Math.max(0.3, Math.min(2, scale * delta));
          
          const mouseX = e.clientX - canvas.offsetLeft;
          const mouseY = e.clientY - canvas.offsetTop;
          
          offsetX = mouseX - (mouseX - offsetX) * (newScale / scale);
          offsetY = mouseY - (mouseY - offsetY) * (newScale / scale);
          
          scale = newScale;
          render();
        });
        
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mouseX = (e.clientX - rect.left - offsetX) / scale;
          const mouseY = (e.clientY - rect.top - offsetY) / scale;
          
          let clickedEdge = null;
          for (const ep of edgePaths) {
            if (isPointNearBezier(mouseX, mouseY, ep.startX, ep.startY, ep.midX, ep.endX, ep.endY, 10 / scale)) {
              clickedEdge = ep;
              break;
            }
          }
          
          if (clickedEdge) {
            selectedEdge = selectedEdge === clickedEdge.index ? null : clickedEdge.index;
            selectedTable = null;
            showEdgeInfo(selectedEdge !== null ? clickedEdge : null);
            render();
            return;
          }
          
          let clicked = null;
          for (const [name, pos] of tablePositions) {
            if (mouseX >= pos.x && mouseX <= pos.x + pos.width &&
                mouseY >= pos.y && mouseY <= pos.y + pos.height) {
              clicked = name;
              break;
            }
          }
          
          selectedTable = clicked === selectedTable ? null : clicked;
          selectedEdge = null;
          showEdgeInfo(null);
          render();
        });
        
        window.addEventListener('resize', () => {
          resizeCanvas();
          render();
        });
      }
      
      function updateTableCount() {
        const countEl = document.getElementById('tableCount');
        countEl.textContent = '${s.relationViewer.tables}: ' + tables.length + ', ${s.relationViewer.relations}: ' + edges.length;
      }
      
      function exportImage() {
        if (tables.length === 0) return;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        tablePositions.forEach((pos) => {
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + pos.width);
          maxY = Math.max(maxY, pos.y + pos.height);
        });
        
        edgePaths.forEach(ep => {
          minX = Math.min(minX, ep.startX, ep.endX);
          minY = Math.min(minY, ep.startY, ep.endY);
          maxX = Math.max(maxX, ep.startX, ep.endX);
          maxY = Math.max(maxY, ep.startY, ep.endY);
        });
        
        const padding = 50;
        const exportWidth = maxX - minX + padding * 2;
        const exportHeight = maxY - minY + padding * 2;
        
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = exportWidth;
        exportCanvas.height = exportHeight;
        const exportCtx = exportCanvas.getContext('2d');
        
        exportCtx.fillStyle = colors.background;
        exportCtx.fillRect(0, 0, exportWidth, exportHeight);
        
        exportCtx.save();
        exportCtx.translate(padding - minX, padding - minY);
        
        exportCtx.strokeStyle = colors.relation;
        exportCtx.lineWidth = 1.5;
        
        edgePaths.forEach(ep => {
          const startX = ep.startX;
          const startY = ep.startY;
          const endX = ep.endX;
          const endY = ep.endY;
          const midX = ep.midX;
          
          exportCtx.beginPath();
          exportCtx.strokeStyle = colors.relation;
          exportCtx.lineWidth = 1.5;
          exportCtx.moveTo(startX, startY);
          exportCtx.bezierCurveTo(midX, startY, midX, endY, endX, endY);
          exportCtx.stroke();
          
          const arrowSize = 8;
          const angle = Math.atan2(endY - startY, endX - midX);
          exportCtx.beginPath();
          exportCtx.fillStyle = colors.relation;
          exportCtx.moveTo(endX, endY);
          exportCtx.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
          exportCtx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
          exportCtx.closePath();
          exportCtx.fill();
        });
        
        tables.forEach(table => {
          const pos = tablePositions.get(table.name);
          if (!pos) return;
          
          const height = HEADER_HEIGHT + (table.columns.length || 1) * ROW_HEIGHT;
          
          exportCtx.fillStyle = colors.headerBg;
          exportCtx.strokeStyle = colors.border;
          exportCtx.lineWidth = 1;
          
          exportCtx.beginPath();
          exportCtx.roundRect(pos.x, pos.y, pos.width, height, 6);
          exportCtx.fill();
          exportCtx.stroke();
          
          exportCtx.fillStyle = colors.foreground;
          exportCtx.font = 'bold 13px sans-serif';
          exportCtx.textBaseline = 'middle';
          exportCtx.fillText(table.name, pos.x + 10, pos.y + HEADER_HEIGHT / 2);
          
          exportCtx.fillStyle = colors.background;
          exportCtx.fillRect(pos.x, pos.y + HEADER_HEIGHT, pos.width, height - HEADER_HEIGHT);
          
          exportCtx.strokeStyle = colors.border;
          exportCtx.lineWidth = 1;
          exportCtx.strokeRect(pos.x, pos.y + HEADER_HEIGHT, pos.width, height - HEADER_HEIGHT);
          
          table.columns.forEach((col, index) => {
            const y = pos.y + HEADER_HEIGHT + index * ROW_HEIGHT;
            
            if (col.isPrimaryKey) {
              exportCtx.fillStyle = colors.primaryKey;
              exportCtx.fillRect(pos.x + 4, y + 4, 4, ROW_HEIGHT - 8);
            }
            
            const fk = edges.find(e => (e.from === table.name || e.from.toLowerCase() === table.name.toLowerCase()) && 
                                        (e.fromColumn === col.name || e.fromColumn.toLowerCase() === col.name.toLowerCase()));
            if (fk) {
              exportCtx.fillStyle = colors.foreignKey;
              exportCtx.fillRect(pos.x + 4, y + 4, 4, ROW_HEIGHT - 8);
            }
            
            exportCtx.fillStyle = colors.foreground;
            exportCtx.font = '12px sans-serif';
            exportCtx.textBaseline = 'middle';
            exportCtx.fillText(col.name, pos.x + 16, y + ROW_HEIGHT / 2);
            
            exportCtx.fillStyle = '#888';
            exportCtx.font = '11px sans-serif';
            const typeText = col.type.length > 15 ? col.type.substring(0, 15) + '...' : col.type;
            exportCtx.fillText(typeText, pos.x + pos.width - exportCtx.measureText(typeText).width - 8, y + ROW_HEIGHT / 2);
          });
        });
        
        exportCtx.restore();
        
        const link = document.createElement('a');
        link.download = 'table-relations.png';
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
      }
      
      if (tables.length === 0) {
        document.querySelector('.canvas-container').innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-text">${s.relationViewer.noRelations}</div>
          </div>
        \`;
      } else {
        init();
      }
    })();
  </script>
</body>
</html>`;
  }

  private _getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  public dispose() {
    TableRelationPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
