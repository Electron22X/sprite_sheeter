class SpriteCutter {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById('canvas-container');
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-upload');
        this.previewGrid = document.getElementById('preview-grid');

        // State
        this.image = null;
        this.zoom = 1;
        this.grid = {
            cols: 8,
            rows: 8,
            cellWidth: 32,
            cellHeight: 32,
            offsetX: 0,
            offsetY: 0
        };
        this.selections = new Set(); // Set of cell indices
        this.mergedCells = []; // Array of {cells: Set, id: string, name: string}
        this.isDragging = false;
        this.isPanning = false;
        this.dragStart = { x: 0, y: 0 };
        this.dragCurrent = { x: 0, y: 0 };
        this.undoStack = [];
        this.redoStack = [];
        this.mode = 'select'; // 'select' or 'define-grid'
        this.showIndices = true;
        this.pixelated = false;
        this.customNames = new Map(); // Store manual renames for individual cell indices
        this.lastSelectedCell = null; // Track last clicked cell for Shift selection
        this.currentMouseButton = null;

        // Panning/Zooming state
        this.panVelocity = { x: 0, y: 0 };
        this.lastPanTime = 0;
        this.isAnimating = false;

        this.initEventListeners();
        this.startAnimationLoop();
    }

    startAnimationLoop() {
        const loop = (time) => {
            if (this.panVelocity.x !== 0 || this.panVelocity.y !== 0) {
                this.container.scrollLeft -= this.panVelocity.x;
                this.container.scrollTop -= this.panVelocity.y;
                
                // Friction
                this.panVelocity.x *= 0.92;
                this.panVelocity.y *= 0.92;
                
                // Stop if very slow
                if (Math.abs(this.panVelocity.x) < 0.1) this.panVelocity.x = 0;
                if (Math.abs(this.panVelocity.y) < 0.1) this.panVelocity.y = 0;
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    updatePixelation() {
        const wrapper = document.getElementById('canvas-wrapper');
        if (this.pixelated) {
            wrapper.classList.add('pixelated');
            this.ctx.imageSmoothingEnabled = false;
        } else {
            wrapper.classList.remove('pixelated');
            this.ctx.imageSmoothingEnabled = true;
        }
    }

    initEventListeners() {
        // Mode switch
        document.getElementById('define-grid-bounds').addEventListener('click', () => {
            this.mode = 'define-grid';
            document.getElementById('define-grid-bounds').classList.add('primary-btn');
            alert("Drag on image to define a single cell's size and position.");
        });

        // Display options
        document.getElementById('toggle-indices').addEventListener('change', (e) => {
            this.showIndices = e.target.checked;
            this.render();
        });
        document.getElementById('toggle-pixelation').addEventListener('change', (e) => {
            this.pixelated = e.target.checked;
            this.updatePixelation();
            this.render();
        });
        // File upload
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('active');
        });
        this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('active'));
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('active');
            if (e.dataTransfer.files.length) this.loadImage(e.dataTransfer.files[0]);
        });
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this.loadImage(e.target.files[0]);
        });

        // Grid controls
        const gridInputs = ['grid-cols', 'grid-rows', 'cell-width', 'cell-height', 'offset-x', 'offset-y'];
        gridInputs.forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.updateGridFromInputs());
        });
        document.getElementById('apply-grid').addEventListener('click', () => this.updateGridFromInputs());

        // Zoom
        document.getElementById('zoom-in').addEventListener('click', () => this.setZoom(this.zoom * 1.2));
        document.getElementById('zoom-out').addEventListener('click', () => this.setZoom(this.zoom / 1.2));
        
        this.container.addEventListener('wheel', (e) => {
            // Check for touchpad pinch (ctrlKey + wheel) or normal wheel with ctrlKey
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                
                // Get mouse position relative to container to zoom towards it
                const rect = this.container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                this.setZoomAt(this.zoom * delta, mouseX, mouseY);
            } else {
                // Natural two-finger scroll/swipe if not zooming
                // Let the browser handle the scroll if it's a normal swipe, 
                // but we might want momentum here too if we're dragging.
            }
        }, { passive: false });

        // Selection buttons
        document.getElementById('select-all').addEventListener('click', () => {
            this.saveState();
            this.selectAll();
        });
        document.getElementById('deselect-all').addEventListener('click', () => {
            this.saveState();
            this.deselectAll();
        });
        document.getElementById('merge-cells').addEventListener('click', () => {
            this.saveState();
            this.mergeSelected();
        });
        document.getElementById('reset-selection').addEventListener('click', () => {
            this.saveState();
            this.resetSelections();
        });

        // Batch rename
        document.getElementById('batch-rename').addEventListener('click', () => this.batchRename());

        // Export
        document.getElementById('download-zip').addEventListener('click', () => this.exportToZip());

        // Canvas interactions
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Touch interactions
        this.touchState = {
            lastDistance: 0,
            lastCenter: { x: 0, y: 0 },
            isPinching: false
        };

        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.undo();
            } else if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                this.redo();
            } else if (e.key === 'Delete') {
                this.saveState();
                this.selections.clear();
                this.render();
                this.updatePreviews();
            } else if (e.key.toLowerCase() === 'i') {
                this.showIndices = !this.showIndices;
                document.getElementById('toggle-indices').checked = this.showIndices;
                this.render();
            } else if (e.key.toLowerCase() === 'p') {
                this.pixelated = !this.pixelated;
                document.getElementById('toggle-pixelation').checked = this.pixelated;
                this.updatePixelation();
                this.render();
            }
        });
    }

    updateGridFromInputs() {
        this.grid.cols = parseInt(document.getElementById('grid-cols').value) || 1;
        this.grid.rows = parseInt(document.getElementById('grid-rows').value) || 1;
        this.grid.cellWidth = parseInt(document.getElementById('cell-width').value) || 1;
        this.grid.cellHeight = parseInt(document.getElementById('cell-height').value) || 1;
        this.grid.offsetX = parseInt(document.getElementById('offset-x').value) || 0;
        this.grid.offsetY = parseInt(document.getElementById('offset-y').value) || 0;
        this.render();
        this.updatePreviews();
    }

    loadImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.image = new Image();
            this.image.onload = () => {
                this.dropZone.style.display = 'none';
                document.getElementById('canvas-wrapper').style.display = 'block';
                this.autoFitGrid();
                this.saveState();
                this.render();
                this.updatePreviews();
            };
            this.image.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    autoFitGrid(keepCellSize = false) {
        if (!this.image) return;
        
        if (!keepCellSize) {
            this.grid.cellWidth = 32;
            this.grid.cellHeight = 32;
            this.grid.offsetX = 0;
            this.grid.offsetY = 0;
            document.getElementById('offset-x').value = 0;
            document.getElementById('offset-y').value = 0;
        }

        this.grid.cols = Math.floor((this.image.width - this.grid.offsetX) / this.grid.cellWidth);
        this.grid.rows = Math.floor((this.image.height - this.grid.offsetY) / this.grid.cellHeight);
        
        document.getElementById('grid-cols').value = this.grid.cols;
        document.getElementById('grid-rows').value = this.grid.rows;
        document.getElementById('cell-width').value = this.grid.cellWidth;
        document.getElementById('cell-height').value = this.grid.cellHeight;
    }

    setZoomAt(newZoom, mouseX, mouseY) {
        const oldZoom = this.zoom;
        const targetZoom = Math.max(0.1, Math.min(10, newZoom));
        
        if (oldZoom === targetZoom) return;

        // Position of the mouse relative to the image before zoom
        const imageX = (this.container.scrollLeft + mouseX) / oldZoom;
        const imageY = (this.container.scrollTop + mouseY) / oldZoom;

        this.zoom = targetZoom;
        document.getElementById('zoom-level').innerText = `${Math.round(this.zoom * 100)}%`;
        
        // Render with new zoom
        this.render();

        // Calculate new scroll position to keep imageX/Y at the same mouseX/Y
        this.container.scrollLeft = imageX * this.zoom - mouseX;
        this.container.scrollTop = imageY * this.zoom - mouseY;
    }

    setZoom(val) {
        // Default behavior: zoom into center of viewport
        const rect = this.container.getBoundingClientRect();
        this.setZoomAt(val, rect.width / 2, rect.height / 2);
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / this.zoom,
            y: (e.clientY - rect.top) / this.zoom
        };
    }

    handleMouseDown(e) {
        if (!this.image) return;
        
        // Stop current momentum if user clicks to pan again
        this.panVelocity = { x: 0, y: 0 };

        // Middle click or Alt+Left click for panning
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            this.isPanning = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.lastPanTime = Date.now();
            return;
        }

        this.saveState();
        this.isDragging = true;
        this.currentMouseButton = e.button; // 0 for left, 2 for right
        this.dragStart = this.getMousePos(e);
        this.dragCurrent = { ...this.dragStart };

        // Handle Shift+Click for merging immediately if it's a single click
        if (e.shiftKey && e.button === 0) {
            this.processShiftSelection(e);
            this.isDragging = false; // Prevent marquee if shift-clicking
        }

        this.render();
    }

    handleTouchStart(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseDown({
                clientX: touch.clientX,
                clientY: touch.clientY,
                button: 0,
                altKey: true // Force pan for single touch
            });
        } else if (e.touches.length === 2) {
            e.preventDefault();
            this.touchState.isPinching = true;
            this.touchState.lastDistance = this.getTouchDistance(e.touches);
            this.touchState.lastCenter = this.getTouchCenter(e.touches);
        }
    }

    handleTouchMove(e) {
        if (e.touches.length === 1 && !this.touchState.isPinching) {
            const touch = e.touches[0];
            this.handleMouseMove({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        } else if (e.touches.length === 2 && this.touchState.isPinching) {
            e.preventDefault();
            const distance = this.getTouchDistance(e.touches);
            const center = this.getTouchCenter(e.touches);
            
            // Zoom
            const delta = distance / this.touchState.lastDistance;
            const rect = this.container.getBoundingClientRect();
            this.setZoomAt(this.zoom * delta, center.x - rect.left, center.y - rect.top);
            
            // Pan
            const dx = center.x - this.touchState.lastCenter.x;
            const dy = center.y - this.touchState.lastCenter.y;
            this.container.scrollLeft -= dx;
            this.container.scrollTop -= dy;
            
            this.touchState.lastDistance = distance;
            this.touchState.lastCenter = center;
        }
    }

    handleTouchEnd(e) {
        this.touchState.isPinching = false;
        this.handleMouseUp(e);
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    getTouchCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    processShiftSelection(e) {
        if (this.lastSelectedCell === null) {
            this.processSelection();
            return;
        }

        const mousePos = this.getMousePos(e);
        const col = Math.floor((mousePos.x - this.grid.offsetX) / this.grid.cellWidth);
        const row = Math.floor((mousePos.y - this.grid.offsetY) / this.grid.cellHeight);
        
        if (row < 0 || row >= this.grid.rows || col < 0 || col >= this.grid.cols) return;

        const startIdx = this.lastSelectedCell;
        const startRow = Math.floor(startIdx / this.grid.cols);
        const startCol = startIdx % this.grid.cols;

        const minR = Math.min(startRow, row);
        const maxR = Math.max(startRow, row);
        const minC = Math.min(startCol, col);
        const maxC = Math.max(startCol, col);

        const rangeCells = new Set();
        for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
                rangeCells.add(r * this.grid.cols + c);
            }
        }

        // Merge this range into a new contiguous block
        const newMerged = {
            cells: rangeCells,
            id: Math.random().toString(36).substr(2, 9),
            name: document.getElementById('prefix').value + (this.mergedCells.length + 1)
        };
        this.mergedCells.push(newMerged);
        
        // Remove individual selections that are now merged
        rangeCells.forEach(idx => this.selections.delete(idx));
        
        this.updatePreviews();
    }

    handleMouseMove(e) {
        const mousePos = this.getMousePos(e);
        
        // Update status bar
        const col = Math.floor((mousePos.x - this.grid.offsetX) / this.grid.cellWidth);
        const row = Math.floor((mousePos.y - this.grid.offsetY) / this.grid.cellHeight);
        
        if (row >= 0 && row < this.grid.rows && col >= 0 && col < this.grid.cols) {
            document.getElementById('cursor-pos').innerText = `Row: ${row}, Col: ${col}`;
        } else {
            document.getElementById('cursor-pos').innerText = `Out of Grid`;
        }
        document.getElementById('pixel-pos').innerText = `X: ${Math.round(mousePos.x)}, Y: ${Math.round(mousePos.y)}`;

        if (this.isPanning) {
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            
            this.container.scrollLeft -= dx;
            this.container.scrollTop -= dy;
            
            // Calculate velocity for momentum
            const now = Date.now();
            const dt = now - this.lastPanTime;
            if (dt > 0) {
                this.panVelocity.x = dx;
                this.panVelocity.y = dy;
            }
            this.lastPanTime = now;
            this.dragStart = { x: e.clientX, y: e.clientY };
            return;
        }
        if (!this.isDragging) return;
        this.dragCurrent = mousePos;
        this.render();
    }

    handleMouseUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            // Keep panVelocity as is for the animation loop
            return;
        }
        if (!this.isDragging) return;
        this.isDragging = false;
        this.currentMouseButton = null;

        if (this.mode === 'define-grid') {
            const startX = Math.min(this.dragStart.x, this.dragCurrent.x);
            const startY = Math.min(this.dragStart.y, this.dragCurrent.y);
            const w = Math.abs(this.dragStart.x - this.dragCurrent.x);
            const h = Math.abs(this.dragStart.y - this.dragCurrent.y);

            if (w > 2 && h > 2) {
                this.grid.offsetX = startX;
                this.grid.offsetY = startY;
                this.grid.cellWidth = w;
                this.grid.cellHeight = h;
                
                document.getElementById('offset-x').value = Math.round(startX);
                document.getElementById('offset-y').value = Math.round(startY);
                document.getElementById('cell-width').value = Math.round(w);
                document.getElementById('cell-height').value = Math.round(h);
                
                // Reset mode
                this.mode = 'select';
                document.getElementById('define-grid-bounds').classList.remove('primary-btn');
                this.autoFitGrid(true); // Fit rows/cols to the image with new cell size
            }
        } else {
            this.processSelection();
        }
        
        this.render();
        this.updatePreviews();
    }

    processSelection() {
        const startX = Math.min(this.dragStart.x, this.dragCurrent.x);
        const startY = Math.min(this.dragStart.y, this.dragCurrent.y);
        const endX = Math.max(this.dragStart.x, this.dragCurrent.x);
        const endY = Math.max(this.dragStart.y, this.dragCurrent.y);

        const startCol = Math.floor((startX - this.grid.offsetX) / this.grid.cellWidth);
        const startRow = Math.floor((startY - this.grid.offsetY) / this.grid.cellHeight);
        const endCol = Math.floor((endX - this.grid.offsetX) / this.grid.cellWidth);
        const endRow = Math.floor((endY - this.grid.offsetY) / this.grid.cellHeight);

        const isSingleClick = Math.abs(this.dragStart.x - this.dragCurrent.x) < 2 && 
                             Math.abs(this.dragStart.y - this.dragCurrent.y) < 2;

        const isRightClick = this.currentMouseButton === 2;

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                if (r >= 0 && r < this.grid.rows && c >= 0 && c < this.grid.cols) {
                    const idx = r * this.grid.cols + c;
                    
                    if (isRightClick) {
                        // Deselect individual
                        this.selections.delete(idx);
                        // Remove from merged if exists
                        this.mergedCells = this.mergedCells.filter(group => !group.cells.has(idx));
                    } else {
                        if (isSingleClick) {
                            if (this.selections.has(idx)) {
                                this.selections.delete(idx);
                                this.lastSelectedCell = null;
                            } else {
                                this.selections.add(idx);
                                this.lastSelectedCell = idx;
                            }
                        } else {
                            this.selections.add(idx);
                            this.lastSelectedCell = idx;
                        }
                    }
                }
            }
        }
    }

    selectAll() {
        this.selections.clear();
        for (let i = 0; i < this.grid.cols * this.grid.rows; i++) {
            this.selections.add(i);
        }
        this.render();
        this.updatePreviews();
    }

    deselectAll() {
        this.selections.clear();
        this.render();
        this.updatePreviews();
    }

    mergeSelected() {
        if (this.selections.size < 2) return;
        const newMerged = {
            cells: new Set(this.selections),
            id: Math.random().toString(36).substr(2, 9),
            name: document.getElementById('prefix').value + (this.mergedCells.length + 1)
        };
        this.mergedCells.push(newMerged);
        this.selections.clear();
        this.render();
        this.updatePreviews();
    }

    resetSelections() {
        this.selections.clear();
        this.mergedCells = [];
        this.render();
        this.updatePreviews();
    }

    batchRename() {
        this.saveState();
        this.customNames.clear(); // Clear manual renames for individual cells to use the new prefix
        const prefix = document.getElementById('prefix').value;
        let count = 1;
        
        // We'll rename all currently visible sprites sequentially
        // This means we need to refresh the merged names and individual names will be handled by the updatePreviews logic
        this.mergedCells.forEach(group => {
            group.name = `${prefix}${count++}`;
        });
        this.updatePreviews();
    }

    saveState() {
        const state = {
            selections: new Set(this.selections),
            mergedCells: this.mergedCells.map(m => ({ ...m, cells: new Set(m.cells) })),
            grid: { ...this.grid },
            customNames: new Map(this.customNames)
        };
        this.undoStack.push(JSON.stringify(state, (key, value) => {
            if (value instanceof Set) return Array.from(value);
            if (value instanceof Map) return Array.from(value.entries());
            return value;
        }));
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const currentState = {
            selections: new Set(this.selections),
            mergedCells: this.mergedCells.map(m => ({ ...m, cells: new Set(m.cells) })),
            grid: { ...this.grid },
            customNames: new Map(this.customNames)
        };
        this.redoStack.push(JSON.stringify(currentState, (key, value) => {
            if (value instanceof Set) return Array.from(value);
            if (value instanceof Map) return Array.from(value.entries());
            return value;
        }));
        
        const prevState = JSON.parse(this.undoStack.pop());
        this.applyState(prevState);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const currentState = {
            selections: new Set(this.selections),
            mergedCells: this.mergedCells.map(m => ({ ...m, cells: new Set(m.cells) })),
            grid: { ...this.grid },
            customNames: new Map(this.customNames)
        };
        this.undoStack.push(JSON.stringify(currentState, (key, value) => {
            if (value instanceof Set) return Array.from(value);
            if (value instanceof Map) return Array.from(value.entries());
            return value;
        }));
        
        const nextState = JSON.parse(this.redoStack.pop());
        this.applyState(nextState);
    }

    applyState(state) {
        this.selections = new Set(state.selections);
        this.mergedCells = state.mergedCells.map(m => ({ ...m, cells: new Set(m.cells) }));
        this.grid = { ...state.grid };
        this.customNames = new Map(state.customNames);
        
        document.getElementById('grid-cols').value = this.grid.cols;
        document.getElementById('grid-rows').value = this.grid.rows;
        document.getElementById('cell-width').value = this.grid.cellWidth;
        document.getElementById('cell-height').value = this.grid.cellHeight;
        document.getElementById('offset-x').value = this.grid.offsetX;
        document.getElementById('offset-y').value = this.grid.offsetY;
        
        this.render();
        this.updatePreviews();
    }

    render() {
        if (!this.image) return;

        this.canvas.width = this.image.width * this.zoom;
        this.canvas.height = this.image.height * this.zoom;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.scale(this.zoom, this.zoom);

        // Draw image
        this.ctx.drawImage(this.image, 0, 0);

        // Draw grid
        this.ctx.strokeStyle = '#000000'; // Pure black
        this.ctx.lineWidth = 1; // 1px
        this.ctx.globalAlpha = 1.0; // 100% opacity
        
        this.ctx.beginPath();
        for (let c = 0; c <= this.grid.cols; c++) {
            const x = Math.round(this.grid.offsetX + c * this.grid.cellWidth);
            this.ctx.moveTo(x, this.grid.offsetY);
            this.ctx.lineTo(x, this.grid.offsetY + this.grid.rows * this.grid.cellHeight);
        }
        for (let r = 0; r <= this.grid.rows; r++) {
            const y = Math.round(this.grid.offsetY + r * this.grid.cellHeight);
            this.ctx.moveTo(this.grid.offsetX, y);
            this.ctx.lineTo(this.grid.offsetX + this.grid.cols * this.grid.cellWidth, y);
        }
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0; // Reset just in case

        // Draw indices (line numbers)
        if (this.showIndices) {
            this.ctx.fillStyle = '#000000'; // Black indices for clarity
            this.ctx.font = `bold ${Math.max(10, 12 / this.zoom)}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            // Column indices (top)
            for (let c = 0; c < this.grid.cols; c++) {
                const x = this.grid.offsetX + (c + 0.5) * this.grid.cellWidth;
                const y = this.grid.offsetY - (10 / this.zoom);
                this.ctx.fillText(c, x, y);
            }

            // Row indices (left)
            this.ctx.textAlign = 'right';
            for (let r = 0; r < this.grid.rows; r++) {
                const x = this.grid.offsetX - (5 / this.zoom);
                const y = this.grid.offsetY + (r + 0.5) * this.grid.cellHeight;
                this.ctx.fillText(r, x, y);
            }
        }

        // Draw selections
        this.ctx.fillStyle = 'rgba(52, 152, 219, 0.6)'; // More distinct selection blue
        this.selections.forEach(idx => {
            const r = Math.floor(idx / this.grid.cols);
            const c = idx % this.grid.cols;
            this.ctx.fillRect(
                this.grid.offsetX + c * this.grid.cellWidth, 
                this.grid.offsetY + r * this.grid.cellHeight, 
                this.grid.cellWidth, 
                this.grid.cellHeight
            );
        });

        // Draw merged cells
        this.mergedCells.forEach(group => {
            this.ctx.fillStyle = 'rgba(46, 204, 113, 0.6)'; // Distinct merged green
            this.ctx.strokeStyle = '#27ae60'; // Darker green border
            this.ctx.lineWidth = 2 / this.zoom;
            
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            group.cells.forEach(idx => {
                const r = Math.floor(idx / this.grid.cols);
                const c = idx % this.grid.cols;
                const x = this.grid.offsetX + c * this.grid.cellWidth;
                const y = this.grid.offsetY + r * this.grid.cellHeight;
                
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + this.grid.cellWidth);
                maxY = Math.max(maxY, y + this.grid.cellHeight);
                
                this.ctx.fillRect(x, y, this.grid.cellWidth, this.grid.cellHeight);
            });
            
            // Draw border around merged group
            this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        });

        // Draw current drag selection box
        if (this.isDragging) {
            this.ctx.strokeStyle = this.currentMouseButton === 2 ? 'rgba(231, 76, 60, 0.9)' : (this.mode === 'define-grid' ? 'rgba(231, 76, 60, 0.9)' : 'rgba(52, 152, 219, 0.9)');
            this.ctx.setLineDash([5, 5]);
            const x = Math.min(this.dragStart.x, this.dragCurrent.x);
            const y = Math.min(this.dragStart.y, this.dragCurrent.y);
            const w = Math.abs(this.dragStart.x - this.dragCurrent.x);
            const h = Math.abs(this.dragStart.y - this.dragCurrent.y);
            this.ctx.strokeRect(x, y, w, h);
            this.ctx.setLineDash([]);
        }

        this.ctx.restore();
    }

    updatePreviews() {
        this.previewGrid.innerHTML = '';
        const prefix = document.getElementById('prefix').value;
        
        // Individual selections
        let count = 1;
        this.selections.forEach(idx => {
            const r = Math.floor(idx / this.grid.cols);
            const c = idx % this.grid.cols;
            const defaultName = `${prefix}${count++}`;
            const name = this.customNames.has(idx) ? this.customNames.get(idx) : defaultName;
            this.addPreviewItem(
                this.grid.offsetX + c * this.grid.cellWidth, 
                this.grid.offsetY + r * this.grid.cellHeight, 
                this.grid.cellWidth, 
                this.grid.cellHeight, 
                name, 
                idx,
                false
            );
        });

        // Merged selections
        this.mergedCells.forEach(group => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            group.cells.forEach(idx => {
                const r = Math.floor(idx / this.grid.cols);
                const c = idx % this.grid.cols;
                minX = Math.min(minX, this.grid.offsetX + c * this.grid.cellWidth);
                minY = Math.min(minY, this.grid.offsetY + r * this.grid.cellHeight);
                maxX = Math.max(maxX, this.grid.offsetX + (c + 1) * this.grid.cellWidth);
                maxY = Math.max(maxY, this.grid.offsetY + (r + 1) * this.grid.cellHeight);
            });
            this.addPreviewItem(minX, minY, maxX - minX, maxY - minY, group.name, group.id, true);
        });
    }

    addPreviewItem(x, y, w, h, name, id, isMerged) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(this.image, x, y, w, h, 0, 0, w, h);

        const item = document.createElement('div');
        item.className = 'preview-item';
        
        const img = new Image();
        img.src = tempCanvas.toDataURL();
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = name;
        input.dataset.id = id;
        input.addEventListener('change', (e) => {
            if (isMerged) {
                const merged = this.mergedCells.find(m => m.id === id);
                if (merged) merged.name = e.target.value;
            } else {
                this.customNames.set(id, e.target.value);
            }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.style.padding = '2px 5px';
        deleteBtn.style.fontSize = '12px';
        deleteBtn.onclick = () => {
            this.saveState();
            if (isMerged) {
                this.mergedCells = this.mergedCells.filter(m => m.id !== id);
            } else {
                this.selections.delete(id);
            }
            this.render();
            this.updatePreviews();
        };

        item.appendChild(img);
        item.appendChild(input);
        item.appendChild(deleteBtn);
        this.previewGrid.appendChild(item);
    }

    async exportToZip() {
        if (!this.image) return;
        const zip = new JSZip();
        const prefix = document.getElementById('prefix').value;
        const manifest = {
            originalImage: 'sprite_sheet.png',
            grid: this.grid,
            sprites: []
        };

        const addSprite = (x, y, w, h, name) => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(this.image, x, y, w, h, 0, 0, w, h);
            
            return new Promise(resolve => {
                tempCanvas.toBlob(blob => {
                    zip.file(`${name}.png`, blob);
                    manifest.sprites.push({ name, x, y, width: w, height: h });
                    resolve();
                }, 'image/png');
            });
        };

        const promises = [];
        
        // Individual selections
        let count = 1;
        this.selections.forEach(idx => {
            const r = Math.floor(idx / this.grid.cols);
            const c = idx % this.grid.cols;
            const defaultName = `${prefix}${count++}`;
            const name = this.customNames.has(idx) ? this.customNames.get(idx) : defaultName;
            promises.push(addSprite(
                this.grid.offsetX + c * this.grid.cellWidth, 
                this.grid.offsetY + r * this.grid.cellHeight, 
                this.grid.cellWidth, 
                this.grid.cellHeight, 
                name
            ));
        });

        // Merged cells
        this.mergedCells.forEach(group => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            group.cells.forEach(idx => {
                const r = Math.floor(idx / this.grid.cols);
                const c = idx % this.grid.cols;
                minX = Math.min(minX, this.grid.offsetX + c * this.grid.cellWidth);
                minY = Math.min(minY, this.grid.offsetY + r * this.grid.cellHeight);
                maxX = Math.max(maxX, this.grid.offsetX + (c + 1) * this.grid.cellWidth);
                maxY = Math.max(maxY, this.grid.offsetY + (r + 1) * this.grid.cellHeight);
            });
            promises.push(addSprite(minX, minY, maxX - minX, maxY - minY, group.name));
        });

        await Promise.all(promises);
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'sprites.zip';
        link.click();
    }
}

// Initialize the app
window.addEventListener('DOMContentLoaded', () => {
    window.app = new SpriteCutter();
});
