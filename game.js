// 创建 Web Worker 用于图像处理
let imageProcessor = null;
let currentGameBoard = null;
let originalImage = null; // 保存原始图像

// 初始化页面
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const game = urlParams.get('game');
    
    if (!game) {
        window.location.href = 'index.html';
        return;
    }

    const gameTitle = document.getElementById('game-title');
    gameTitle.textContent = game.charAt(0).toUpperCase() + game.slice(1);

    setupImageUpload();
    initializeWorker();
    setupSolveButton();
});

// 设置求解按钮
function setupSolveButton() {
    const solveButton = document.getElementById('solveButton');
    const statusMessage = document.getElementById('statusMessage');
    const solutionCanvas = document.getElementById('solutionCanvas');

    solveButton.addEventListener('click', () => {
        if (currentGameBoard) {
            updateButtonState(false, '正在求解...');
            // 确保solutionCanvas可见
            solutionCanvas.style.display = 'block';
            imageProcessor.postMessage({
                type: 'solveGame',
                board: currentGameBoard
            });
        }
    });

    // 初始状态
    updateButtonState(false, '请上传游戏板图片');
}

// 更新按钮状态和消息
function updateButtonState(enabled, message, isError = false) {
    const solveButton = document.getElementById('solveButton');
    const statusMessage = document.getElementById('statusMessage');

    solveButton.disabled = !enabled;
    statusMessage.textContent = message;
    statusMessage.className = 'status-message' + (isError ? ' error' : '');
}

// 设置图片上传功能
function setupImageUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const previewContainer = document.getElementById('previewContainer');
    const preview = document.getElementById('preview');
    const solutionCanvas = document.getElementById('solutionCanvas');

    // 点击上传
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    // 拖放上传
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    // 文件选择处理
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // 处理上传的文件
    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('请上传图片文件');
            return;
        }

        // 获取所需的 DOM 元素
        const preview = document.getElementById('preview');
        const previewContainer = document.getElementById('previewContainer');
        const uploadArea = document.getElementById('uploadArea');
        const solutionCanvas = document.getElementById('solutionCanvas');

        // 重置状态
        updateButtonState(false, '正在处理图片...');
        currentGameBoard = null;

        const reader = new FileReader();
        reader.onload = (e) => {
            // 创建一个新的图像对象
            const img = new Image();
            img.onload = () => {
                // 保存原始图像以供后续处理
                originalImage = img;

                // 更新预览
                preview.src = img.src;
                previewContainer.style.display = 'block';
                uploadArea.style.display = 'none';

                // 创建一个临时 canvas 来获取图像数据
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(img, 0, 0);

                // 设置解决方案 canvas 的尺寸
                solutionCanvas.width = img.width;
                solutionCanvas.height = img.height;

                // 获取图像数据并发送到 Worker
                const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
                if (imageProcessor) {
                    imageProcessor.postMessage({
                        type: 'processImage',
                        imageData: imageData
                    }, [imageData.data.buffer]);
                }

                // 重置显示状态
                preview.style.display = 'block';
                solutionCanvas.style.display = 'none';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

// 初始化 Web Worker
function initializeWorker() {
    // 创建 Worker
    imageProcessor = new Worker('imageProcessor.worker.js');
    
    // 处理 Worker 返回的消息
    imageProcessor.onmessage = (e) => {
        if (e.data.type === 'error') {
            console.error(e.data.message);
            updateButtonState(false, e.data.message, true);
            currentGameBoard = null;
        } else if (e.data.type === 'progress') {
            // console.log(e.data.message);
            updateButtonState(false, e.data.message);
        } else if (e.data.type === 'result') {
            // console.log('检测到游戏板:', e.data.board);
            currentGameBoard = e.data.board;
            drawDetectedBoard(e.data.board);
            updateButtonState(true, '游戏板已就绪，可以开始求解');
        } else if (e.data.type === 'solution') {
            displaySolution(e.data.solution);
            updateButtonState(true, '求解完成！');
        } else if (e.data.type === 'colorRegions') {
            // 创建新的画布层来显示颜色区域
            const regionsCanvas = document.getElementById('regionsCanvas');
            const ctx = regionsCanvas.getContext('2d');
            
            // 设置画布尺寸
            regionsCanvas.width = e.data.imageData.width;
            regionsCanvas.height = e.data.imageData.height;
            
            // 绘制颜色区域
            // ctx.putImageData(e.data.imageData, 0, 0);
        } else if (e.data.type === 'debug') {
            // 创建或获取调试画布
            // let debugCanvas = document.getElementById('debugCanvas');
            // if (!debugCanvas) {
            //     debugCanvas = document.createElement('canvas');
            //     debugCanvas.id = 'debugCanvas';
            //     debugCanvas.style.position = 'absolute';
            //     debugCanvas.style.top = '0';
            //     debugCanvas.style.left = '0';
            //     debugCanvas.style.zIndex = '3';  // 确保在其他画布之上
            //     document.querySelector('.canvas-container').appendChild(debugCanvas);
            // }

            // const ctx = debugCanvas.getContext('2d');
            
            // // 设置画布尺寸
            // debugCanvas.width = e.data.imageData.width;
            // debugCanvas.height = e.data.imageData.height;
            
            // // 绘制调试图像
            // ctx.putImageData(e.data.imageData, 0, 0);
            
            // console.log('Debug message:', e.data.message);
        }
    };
}

// 在 canvas 上绘制检测到的游戏板
function drawDetectedBoard(board) {
    const canvas = document.getElementById('solutionCanvas');
    const preview = document.getElementById('preview');
    const ctx = canvas.getContext('2d');
    
    // 创建一个临时canvas用于裁剪
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = board.bounds.width;
    tempCanvas.height = board.bounds.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // 在临时canvas上绘制裁剪后的图像
    tempCtx.drawImage(originalImage, 
        board.bounds.x, board.bounds.y, board.bounds.width, board.bounds.height,
        0, 0, board.bounds.width, board.bounds.height
    );
    
    // 更新预览图像为裁剪后的版本
    preview.src = tempCanvas.toDataURL();
    
    // 调整canvas大小以匹配裁剪后的图像
    canvas.width = board.bounds.width;
    canvas.height = board.bounds.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制网格线
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    
    // 绘制水平线
    board.gridLines.horizontal.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y);
        ctx.lineTo(line.x2, line.y);
        ctx.stroke();
    });
    
    // 绘制垂直线
    board.gridLines.vertical.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(line.x, line.y1);
        ctx.lineTo(line.x, line.y2);
        ctx.stroke();
    });

    // 绘制检测到的标记
    // board.markers.forEach((row, i) => {
    //     row.forEach((marker, j) => {
    //         const cell = board.cellCoordinates[i][j];
    //         ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            
    //         if (marker === 'queen') {
    //             // 绘制皇后标记
    //             ctx.font = '20px Arial';
    //             ctx.fillText('♕', cell.center.x - 10, cell.center.y + 7);
    //         } else if (marker === 'x') {
    //             // 绘制X标记
    //             ctx.beginPath();
    //             ctx.moveTo(cell.x1 + 5, cell.y1 + 5);
    //             ctx.lineTo(cell.x2 - 5, cell.y2 - 5);
    //             ctx.moveTo(cell.x2 - 5, cell.y1 + 5);
    //             ctx.lineTo(cell.x1 + 5, cell.y2 - 5);
    //             ctx.stroke();
    //         }
    //     });
    // });
    // 显示检测到的大小
    ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.font = '20px Arial';
    ctx.fillText(`检测到 ${board.size}x${board.size} 的游戏板`, 10, 30);
}

// 显示解决方案
function displaySolution(solution) {
    const preview = document.getElementById('preview');
    const canvas = document.getElementById('solutionCanvas');
    const ctx = canvas.getContext('2d');
    
    // 使用预览图像的渲染尺寸
    const renderWidth = preview.clientWidth;
    const renderHeight = preview.clientHeight;
    
    // 计算缩放比例
    const scaleX = renderWidth / currentGameBoard.bounds.width;
    const scaleY = renderHeight / currentGameBoard.bounds.height;
    
    // 设置canvas大小为渲染尺寸
    canvas.width = renderWidth;
    canvas.height = renderHeight;

    // 清除画布并绘制预览图像
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(preview, 0, 0, renderWidth, renderHeight);

    preview.style.display = 'none';

    // 绘制解决方案
    solution.forEach((row, i) => {
        row.forEach((cell, j) => {
            if (cell === 1) {
                const cellCoord = currentGameBoard.cellCoordinates[i][j];
                
                // 缩放坐标
                const scaledX = cellCoord.center.x * scaleX;
                const scaledY = cellCoord.center.y * scaleY;
                
                // 根据缩放调整字体大小
                const fontSize = Math.round(48 * Math.min(scaleX, scaleY));
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.font = `bold ${fontSize}px Arial`;
                
                // 绘制皇后标记
                ctx.fillText('Q', 
                    scaledX - (fontSize/2), 
                    scaledY + (fontSize/3)
                );
            }
        });
    });
} 