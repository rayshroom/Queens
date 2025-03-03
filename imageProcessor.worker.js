// 在 Worker 中加载 OpenCV
importScripts('https://docs.opencv.org/4.8.0/opencv.js');

// 等待 OpenCV.js 加载完成
self.onmessage = function (e) {
    if (e.data.type === 'processImage') {
        // 确保 OpenCV 已加载
        if (typeof cv === 'undefined') {
            postMessage({ type: 'error', message: 'OpenCV 未加载' });
            return;
        }

        try {
            postMessage({ type: 'progress', message: '正在加载图像...' });
            // 从 ImageData 创建 Mat
            let img = cv.matFromImageData(e.data.imageData);

            postMessage({ type: 'progress', message: '正在预处理图像...' });
            // 预处理图像
            let processed = preprocessImage(img);

            postMessage({ type: 'progress', message: '正在检测网格...' });
            // 检测网格
            let { gridLines, size, cellCoordinates } = detectGrid(processed);

            if (!gridLines || size < 4) {
                postMessage({ type: 'error', message: '未能检测到有效的游戏板' });
                return;
            }

            postMessage({ type: 'progress', message: '正在裁剪图像...' });
            // 计算边界并裁剪图像
            let bounds = calculateBoardBounds(gridLines);
            let croppedImg = cropImage(img, bounds);
            let croppedProcessed = cropImage(processed, bounds);

            // 调整网格线坐标
            adjustGridCoordinates(gridLines, bounds);
            adjustCellCoordinates(cellCoordinates, bounds);

            postMessage({ type: 'progress', message: '正在移除标记...' });
            // 移除标记并进行区域检测
            // let cleanedImg = removeMarkers(croppedImg, cellCoordinates);
            let cleanedImg = croppedImg;

            postMessage({ type: 'progress', message: '正在识别颜色区域...' });
            let regions = detectColorRegions(cleanedImg, gridLines, size);

            if (!validateRegions(regions, size)) {
                postMessage({ type: 'error', message: '检测到的区域数量不正确或区域不连通' });
                return;
            }

            postMessage({ type: 'progress', message: '正在检测预填标记...' });
            // 检测预填标记
            let markers = detectMarkers(croppedImg, cellCoordinates);

            // 转换为数据结构
            let gameBoard = {
                size: size,
                regions: regions,
                gridLines: gridLines,
                cellCoordinates: cellCoordinates,
                markers: markers,
                bounds: bounds
            };

            postMessage({
                type: 'result',
                message: '游戏板检测成功',
                board: gameBoard
            });

            // 清理内存
            img.delete();
            processed.delete();
            croppedImg.delete();
            croppedProcessed.delete();
            // cleanedImg.delete();
            // regions.delete();

        } catch (error) {
            let errorMessage = '';
            if (typeof error === 'number') {
                // OpenCV 错误代码处理
                switch (error) {
                    case -215:
                        errorMessage = 'OpenCV错误: 图像大小或类型不正确';
                        break;
                    case 6867112:
                        errorMessage = 'OpenCV错误: 内存分配失败或矩阵操作错误';
                        break;
                    default:
                        errorMessage = `OpenCV错误代码: ${error}`;
                }
            } else {
                // 常规 JavaScript 错误
                errorMessage = error.message || error.toString();
            }

            console.error('详细错误信息:', error);
            postMessage({
                type: 'error',
                message: `图像处理失败: ${errorMessage}`
            });
        }
    } else if (e.data.type === 'solveGame') {
        try {
            console.time('solving');  // 添加计时器
            const solution = solveQueens(e.data.board.size, e.data.board.regions);
            console.timeEnd('solving');  // 输出求解时间
            
            if (solution) {
                postMessage({
                    type: 'solution',
                    solution: solution
                });
            } else {
                postMessage({
                    type: 'error',
                    message: '无法找到解决方案'
                });
            }
        } catch (error) {
            postMessage({
                type: 'error',
                message: '求解出错: ' + error.message
            });
        }
    }
};

// 计算游戏板边界
function calculateBoardBounds(gridLines) {
    const horizontal = gridLines.horizontal;
    const vertical = gridLines.vertical;

    // 获取边界坐标
    const x1 = Math.min(...vertical.map(line => line.x));
    const x2 = Math.max(...vertical.map(line => line.x));
    const y1 = Math.min(...horizontal.map(line => line.y));
    const y2 = Math.max(...horizontal.map(line => line.y));

    // 添加一些边距
    const padding = 20;

    return {
        x: Math.max(0, x1 - padding),
        y: Math.max(0, y1 - padding),
        width: x2 - x1 + padding * 2,
        height: y2 - y1 + padding * 2
    };
}

// 裁剪图像
function cropImage(img, bounds) {
    let rect = new cv.Rect(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
    );
    return img.roi(rect);
}

// 调整网格线坐标
function adjustGridCoordinates(gridLines, bounds) {
    gridLines.horizontal.forEach(line => {
        line.y -= bounds.y;
        line.x1 -= bounds.x;
        line.x2 -= bounds.x;
    });

    gridLines.vertical.forEach(line => {
        line.x -= bounds.x;
        line.y1 -= bounds.y;
        line.y2 -= bounds.y;
    });
}

// 调整单元格坐标
function adjustCellCoordinates(cellCoordinates, bounds) {
    cellCoordinates.forEach(row => {
        row.forEach(cell => {
            cell.x1 -= bounds.x;
            cell.x2 -= bounds.x;
            cell.y1 -= bounds.y;
            cell.y2 -= bounds.y;
            cell.center.x -= bounds.x;
            cell.center.y -= bounds.y;
        });
    });
}

// 移除标记
function removeMarkers(img, cellCoordinates) {
    let result = img.clone();
    postMessage({ type: 'progress', message: 'Cloned image...' });
    // 对每个单元格进行处理
    cellCoordinates.forEach(row => {
        row.forEach(cell => {
            // 获取单元格区域
            let cellRect = new cv.Rect(
                cell.x1,
                cell.y1,
                cell.x2 - cell.x1,
                cell.y2 - cell.y1
            );
            let cellROI = result.roi(cellRect);
            postMessage({ type: 'progress', message: 'Got cell ROI...' });
            // 转换为灰度图进行处理
            let gray = new cv.Mat();
            postMessage({ type: 'progress', message: 'created gray mat...' });
            cv.cvtColor(cellROI, gray, cv.COLOR_BGR2GRAY);
            postMessage({ type: 'progress', message: 'Converted to gray...' });
            // 使用自适应阈值检测标记
            let binary = new cv.Mat();
            cv.adaptiveThreshold(gray, binary, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV, 11, 2);
            postMessage({ type: 'progress', message: 'Adaptive threshold applied...' });
            // 查找轮廓
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(binary, contours, hierarchy,
                cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            postMessage({ type: 'progress', message: 'Found contours...' });
            // 移除较大的轮廓（可能是标记）
            let cellArea = cellROI.rows * cellROI.cols;
            for (let i = 0; i < contours.size(); i++) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                if (area > cellArea * 0.1) { // 如果轮廓面积超过单元格面积的10%
                    // 用周围颜色填充标记区域
                    let mask = cv.Mat.zeros(cellROI.rows, cellROI.cols, cv.CV_8U);
                    cv.drawContours(mask, contours, i, new cv.Scalar(255), -1);
                    cv.inpaint(cellROI, mask, cellROI, 3, cv.INPAINT_TELEA);
                    mask.delete();
                }
                cnt.delete();
            }

            // 清理内存
            contours.delete();
            hierarchy.delete();
            gray.delete();
            binary.delete();
        });
    });

    return result;
}

// 预处理图像
function preprocessImage(img) {
    let processed = new cv.Mat();

    // 转换为灰度图
    cv.cvtColor(img, processed, cv.COLOR_RGBA2GRAY);

    // 高斯模糊减少噪声
    cv.GaussianBlur(processed, processed, new cv.Size(5, 5), 0);

    // 自适应阈值处理
    cv.adaptiveThreshold(processed, processed, 255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY_INV, 11, 2);

    return processed;
}

// 检测网格
function detectGrid(img) {
    try {
        let lines = new cv.Mat();
        cv.HoughLinesP(img, lines, 1, Math.PI / 180, 50, 50, 10);

        let horizontalLines = [];
        let verticalLines = [];
        const minLength = img.cols * 0.5;

        // 收集所有线条
        for (let i = 0; i < lines.rows; i++) {
            let x1 = lines.data32S[i * 4];
            let y1 = lines.data32S[i * 4 + 1];
            let x2 = lines.data32S[i * 4 + 2];
            let y2 = lines.data32S[i * 4 + 3];

            let length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            if (length < minLength) continue;

            let angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

            if (Math.abs(angle) < 45) {
                horizontalLines.push({ y: (y1 + y2) / 2, x1, x2, y1, y2 });
            } else if (Math.abs(angle) > 45) {
                verticalLines.push({ x: (x1 + x2) / 2, y1, y2, x1, x2 });
            }
        }

        // 合并相近的线条
        horizontalLines = mergeNearbyLines(horizontalLines, 'horizontal');
        verticalLines = mergeNearbyLines(verticalLines, 'vertical');

        // 检查线条的交叉点
        let validHorizontalLines = [];
        let validVerticalLines = [];

        // 检查每条水平线
        horizontalLines.forEach(hLine => {
            let hasIntersection = false;
            // 检查是否与任何垂直线相交
            for (let vLine of verticalLines) {
                if (linesIntersect(hLine, vLine)) {
                    hasIntersection = true;
                    break;
                }
            }
            if (hasIntersection) {
                validHorizontalLines.push(hLine);
            }
        });

        // 检查每条垂直线
        verticalLines.forEach(vLine => {
            let hasIntersection = false;
            // 检查是否与任何水平线相交
            for (let hLine of validHorizontalLines) {
                if (linesIntersect(hLine, vLine)) {
                    hasIntersection = true;
                    break;
                }
            }
            if (hasIntersection) {
                validVerticalLines.push(vLine);
            }
        });

        // 对有效线条进行排序
        validHorizontalLines.sort((a, b) => a.y - b.y);
        validVerticalLines.sort((a, b) => a.x - b.x);

        // 创建可视化之前检查图像是否有效
        if (img.empty() || img.rows === 0 || img.cols === 0) {
            lines.delete();
            return { gridLines: null, size: 0, cellCoordinates: null };
        }

        // 创建一个彩色图像用于可视化
        let visualized = new cv.Mat();
        try {
            cv.cvtColor(img, visualized, cv.COLOR_GRAY2BGR);

            // 绘制水平线（红色）
            validHorizontalLines.forEach(line => {
                let pt1 = new cv.Point(line.x1, line.y);
                let pt2 = new cv.Point(line.x2, line.y);
                cv.line(visualized, pt1, pt2, new cv.Scalar(0, 0, 255), 2);
            });

            // 绘制垂直线（红色）
            validVerticalLines.forEach(line => {
                let pt1 = new cv.Point(line.x, line.y1);
                let pt2 = new cv.Point(line.x, line.y2);
                cv.line(visualized, pt1, pt2, new cv.Scalar(0, 0, 255), 2);
            });

            // 转换为 RGBA 格式
            let visualizedRGBA = new cv.Mat();
            cv.cvtColor(visualized, visualizedRGBA, cv.COLOR_BGR2RGBA);

            // 将可视化结果发送回主线程
            let imgData = new ImageData(
                new Uint8ClampedArray(visualizedRGBA.data),
                visualizedRGBA.cols,
                visualizedRGBA.rows
            );

            // postMessage({
            //     type: 'debug',
            //     message: '网格检测可视化',
            //     imageData: imgData
            // });

            // 清理内存
            visualizedRGBA.delete();
        } finally {
            visualized.delete();
        }

        // 清理内存
        lines.delete();

        let gridSize = Math.min(
            validHorizontalLines.length - 1, 
            validVerticalLines.length - 1
        );

        if (gridSize < 4) {
            return { gridLines: null, size: 0, cellCoordinates: null };
        }

        // 计算单元格坐标
        let cellCoordinates = [];
        for (let i = 0; i < validHorizontalLines.length - 1; i++) {
            let row = [];
            for (let j = 0; j < validVerticalLines.length - 1; j++) {
                row.push({
                    x1: validVerticalLines[j].x,
                    y1: validHorizontalLines[i].y,
                    x2: validVerticalLines[j + 1].x,
                    y2: validHorizontalLines[i + 1].y,
                    center: {
                        x: (validVerticalLines[j].x + validVerticalLines[j + 1].x) / 2,
                        y: (validHorizontalLines[i].y + validHorizontalLines[i + 1].y) / 2
                    }
                });
            }
            cellCoordinates.push(row);
        }

        return {
            gridLines: {
                horizontal: validHorizontalLines,
                vertical: validVerticalLines
            },
            size: gridSize,
            cellCoordinates: cellCoordinates
        };

    } catch (error) {
        console.error('Grid detection error:', error);
        // 确保在错误发生时也能清理内存
        if (typeof lines !== 'undefined') lines.delete();
        if (typeof visualized !== 'undefined') visualized.delete();
        if (typeof visualizedRGBA !== 'undefined') visualizedRGBA.delete();
        throw error;
    }
}

function mergeNearbyLines(lines, type) {
    if (lines.length === 0) return lines;

    // 定义合并阈值（像素距离）
    const threshold = 20;
    
    // 按照主要坐标排序（水平线按y坐标，垂直线按x坐标）
    lines.sort((a, b) => type === 'horizontal' ? a.y - b.y : a.x - b.x);

    let mergedLines = [];
    let currentGroup = [lines[0]];
    
    for (let i = 1; i < lines.length; i++) {
        let currentLine = lines[i];
        let previousLine = currentGroup[currentGroup.length - 1];
        
        // 检查是否应该合并
        let shouldMerge = false;
        if (type === 'horizontal') {
            shouldMerge = Math.abs(currentLine.y - previousLine.y) < threshold;
        } else {
            shouldMerge = Math.abs(currentLine.x - previousLine.x) < threshold;
        }

        if (shouldMerge) {
            currentGroup.push(currentLine);
        } else {
            // 合并当前组中的线条
            mergedLines.push(mergeLinesInGroup(currentGroup, type));
            currentGroup = [currentLine];
        }
    }
    
    // 处理最后一组
    mergedLines.push(mergeLinesInGroup(currentGroup, type));
    
    return mergedLines;
}

function mergeLinesInGroup(group, type) {
    if (group.length === 1) return group[0];

    if (type === 'horizontal') {
        // 合并水平线
        let avgY = group.reduce((sum, line) => sum + line.y, 0) / group.length;
        let minX1 = Math.min(...group.map(line => line.x1));
        let maxX2 = Math.max(...group.map(line => line.x2));
        let avgY1 = group.reduce((sum, line) => sum + line.y1, 0) / group.length;
        let avgY2 = group.reduce((sum, line) => sum + line.y2, 0) / group.length;
        
        return {
            y: avgY,
            x1: minX1,
            x2: maxX2,
            y1: avgY1,
            y2: avgY2
        };
    } else {
        // 合并垂直线
        let avgX = group.reduce((sum, line) => sum + line.x, 0) / group.length;
        let minY1 = Math.min(...group.map(line => line.y1));
        let maxY2 = Math.max(...group.map(line => line.y2));
        let avgX1 = group.reduce((sum, line) => sum + line.x1, 0) / group.length;
        let avgX2 = group.reduce((sum, line) => sum + line.x2, 0) / group.length;
        
        return {
            x: avgX,
            y1: minY1,
            y2: maxY2,
            x1: avgX1,
            x2: avgX2
        };
    }
}

// 辅助函数：检查两条线是否相交
function linesIntersect(hLine, vLine) {
    // 定义容差范围（像素）
    const tolerance = 10;
    
    // 检查垂直线的x坐标是否在水平线的x范围内
    if (vLine.x >= Math.min(hLine.x1, hLine.x2) - tolerance && 
        vLine.x <= Math.max(hLine.x1, hLine.x2) + tolerance) {
        // 检查水平线的y坐标是否在垂直线的y范围内
        if (hLine.y >= Math.min(vLine.y1, vLine.y2) - tolerance && 
            hLine.y <= Math.max(vLine.y1, vLine.y2) + tolerance) {
            return true;
        }
    }
    return false;
}

// 检测颜色区域
function detectColorRegions(img, gridLines, size) {

    let imgHSV = new cv.Mat();
    let visualized = img.clone();

    try {
        // 绘制网格线
        for (let line of gridLines.horizontal) {
            let pt1 = new cv.Point(Math.floor(line.x1), Math.floor(line.y));
            let pt2 = new cv.Point(Math.floor(line.x2), Math.floor(line.y));
            cv.line(visualized, pt1, pt2, new cv.Scalar(0, 0, 255), 2);
        }
        for (let line of gridLines.vertical) {
            let pt1 = new cv.Point(Math.floor(line.x), Math.floor(line.y1));
            let pt2 = new cv.Point(Math.floor(line.x), Math.floor(line.y2));
            cv.line(visualized, pt1, pt2, new cv.Scalar(0, 0, 255), 2);
        }

        // 转换为HSV颜色空间
        cv.cvtColor(img, imgHSV, cv.COLOR_BGR2HSV);

        // 存储每个网格的颜色信息
        let regionMatrix = Array(size).fill().map(() => Array(size).fill(0));
        let allColors = [];  // 存储所有采样点的颜色

        // 对每个网格进行采样
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                let x1 = Math.floor(gridLines.vertical[j].x);
                let y1 = Math.floor(gridLines.horizontal[i].y);
                let x2 = Math.floor(gridLines.vertical[j + 1].x);
                let y2 = Math.floor(gridLines.horizontal[i + 1].y);

                const offset = 20;
                
                // 定义采样点
                let samplePoints = [
                    { x: x1 + offset, y: y1 + offset },
                    { x: x2 - offset, y: y1 + offset },
                    { x: x1 + offset, y: y2 - offset },
                    { x: x2 - offset, y: y2 - offset }
                ];

                // 获取颜色样本
                let colorSum = { h: 0, s: 0, v: 0 };
                for (let point of samplePoints) {
                    try {
                        let pixel = imgHSV.ucharPtr(point.y, point.x);
                        colorSum.h += pixel[0];
                        colorSum.s += pixel[1];
                        colorSum.v += pixel[2];
                    } catch (e) {
                        console.error('Error accessing pixel:', point, e);
                        throw e;
                    }
                }

                // 计算平均颜色
                let avgColor = {
                    h: Math.round(colorSum.h / 4),
                    s: Math.round(colorSum.s / 4),
                    v: Math.round(colorSum.v / 4)
                };

                allColors.push({
                    color: avgColor,
                    gridPos: { i, j }
                });

                // 绘制采样点
                for (let point of samplePoints) {
                    cv.circle(
                        visualized,
                        new cv.Point(point.x, point.y),
                        2,
                        new cv.Scalar(255, 0, 0),
                        -1
                    );
                }

                // 在调试可视化中填充网格颜色
                let rgbColor = hsvToRgb(
                    (avgColor.h * 2), // OpenCV的H范围是0-180，需要转换到0-360
                    avgColor.s / 255,
                    avgColor.v / 255
                );
                
                // 创建半透明的颜色叠加
                cv.rectangle(
                    visualized,
                    new cv.Point(x1, y1),
                    new cv.Point(x2, y2),
                    new cv.Scalar(rgbColor[0], rgbColor[1], rgbColor[2]),
                    -1  // 填充矩形
                );
            }
        }

        // 基于颜色相似性分配区域标签
        let currentLabel = 0;
        let colorLabels = new Map();  // 存储颜色到标签的映射

        for (let colorInfo of allColors) {
            let found = false;
            for (let [key, label] of colorLabels) {
                let [h, s, v] = key.split(',').map(Number);
                if (isColorSimilar(colorInfo.color, { h, s, v })) {
                    regionMatrix[colorInfo.gridPos.i][colorInfo.gridPos.j] = label;
                    found = true;
                    break;
                }
            }
            if (!found) {
                colorLabels.set(
                    `${colorInfo.color.h},${colorInfo.color.s},${colorInfo.color.v}`,
                    currentLabel
                );
                regionMatrix[colorInfo.gridPos.i][colorInfo.gridPos.j] = currentLabel;
                currentLabel++;
            }
        }

        // 发送调试可视化
        let debugVisualRGBA = new cv.Mat();
        cv.cvtColor(visualized, debugVisualRGBA, cv.COLOR_BGR2RGBA);
        // postMessage({
        //     type: 'debug',
        //     message: '网格和采样点可视化',
        //     imageData: new ImageData(
        //         new Uint8ClampedArray(debugVisualRGBA.data),
        //         debugVisualRGBA.cols,
        //         debugVisualRGBA.rows
        //     )
        // });

        debugVisualRGBA.delete();

        return regionMatrix;

    } catch (error) {
        console.error('Color region detection error:', error);
        throw error;
    } finally {
        imgHSV.delete();
        visualized.delete();
    }
}

function isColorSimilar(color1, color2) {
    const hueThreshold = 10;
    const satThreshold = 30;
    const valThreshold = 30;

    return Math.abs(color1.h - color2.h) <= hueThreshold &&
           Math.abs(color1.s - color2.s) <= satThreshold &&
           Math.abs(color1.v - color2.v) <= valThreshold;
}

// 验证区域
function validateRegions(regions, size) {
    // 检查是否有正确数量的区域
    let regionCount = new Set();
    for (let i = 0; i < regions.length; i++) {
        for (let j = 0; j < regions[0].length; j++) {
            regionCount.add(regions[i][j]);
        }
    }

    return regionCount.size === size;
}

// 检测标记（X和皇后）
function detectMarkers(img, cellCoordinates) {
    let markers = [];

    // 为每个单元格创建ROI并分析
    for (let i = 0; i < cellCoordinates.length; i++) {
        let row = [];
        for (let j = 0; j < cellCoordinates[i].length; j++) {
            let cell = cellCoordinates[i][j];

            // 提取单元格ROI
            let roi = img.roi(new cv.Rect(
                cell.x1,
                cell.y1,
                cell.x2 - cell.x1,
                cell.y2 - cell.y1
            ));

            // 检测标记类型
            let markerType = detectMarkerType(roi);
            row.push(markerType);

            roi.delete();
        }
        markers.push(row);
    }

    return markers;
}

// 检测标记类型
function detectMarkerType(roi) {
    // 转换为灰度图
    let gray = new cv.Mat();
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);

    // 二值化
    let binary = new cv.Mat();
    cv.threshold(gray, binary, 127, 255, cv.THRESH_BINARY);

    // 查找轮廓
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // 分析轮廓特征
    let markerType = 'empty';

    if (contours.size() > 0) {
        // 分析最大轮廓
        let maxArea = 0;
        let maxContourIndex = 0;

        for (let i = 0; i < contours.size(); i++) {
            let area = cv.contourArea(contours.get(i));
            if (area > maxArea) {
                maxArea = area;
                maxContourIndex = i;
            }
        }

        let contour = contours.get(maxContourIndex);

        // 计算轮廓特征
        let perimeter = cv.arcLength(contour, true);
        let approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.04 * perimeter, true);

        // 根据特征判断标记类型
        if (approx.rows >= 8) { // 可能是皇后（较复杂的形状）
            markerType = 'queen';
        } else if (approx.rows >= 4) { // 可能是X标记
            markerType = 'x';
        }

        approx.delete();
    }

    // 清理内存
    contours.delete();
    hierarchy.delete();
    gray.delete();
    binary.delete();

    return markerType;
}

// 求解带颜色区域约束的八皇后问题
function solveQueens(boardSize, colorRegions) {
    
    if (!colorRegions || !Array.isArray(colorRegions) || colorRegions.length === 0) {
        console.error('Invalid colorRegions:', colorRegions);
        return null;
    }

    let cols = new Set();
    let diag1 = new Set(); // 左上到右下对角线 (r + c)
    let diag2 = new Set(); // 右上到左下对角线 (r - c)
    let board = Array(boardSize).fill().map(() => Array(boardSize).fill(0));
    
    // 记录每个颜色区域已放置的皇后数量
    let regionQueens = new Map();
    
    // 初始化每个区域的皇后计数并验证数据
    try {
        for (let i = 0; i < colorRegions.length; i++) {
            if (!Array.isArray(colorRegions[i])) {
                console.error(`Invalid row at index ${i}:`, colorRegions[i]);
                return null;
            }
            for (let j = 0; j < colorRegions[i].length; j++) {
                let region = colorRegions[i][j];
                if (region === undefined || region === null) {
                    console.error(`Invalid region at [${i},${j}]:`, region);
                    return null;
                }
                if (!regionQueens.has(region)) {
                    regionQueens.set(region, 0);
                }
            }
        }
    } catch (e) {
        console.error('Error during initialization:', e);
        return null;
    }

    // 检查位置是否有效
    function isValid(row, col) {
        try {
            // 检查边界
            if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) {
                console.warn(`Invalid position: [${row},${col}]`);
                return false;
            }

            // 基本的八皇后约束
            if (cols.has(col)) {
                return false;
            }

            // 检查相邻位置是否有皇后
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    let newRow = row + dr;
                    let newCol = col + dc;
                    if (newRow >= 0 && newRow < boardSize && 
                        newCol >= 0 && newCol < boardSize && 
                        board[newRow][newCol] === 1) {
                        return false;
                    }
                }
            }

            // 检查颜色区域约束
            let region = colorRegions[row][col];
            if (region === undefined || region === null) {
                console.error(`Invalid region at [${row},${col}]`);
                return false;
            }
            if (!regionQueens.has(region)) {
                console.error(`Region not found in map:`, region);
                return false;
            }
            if (regionQueens.get(region) >= 1) {
                return false;
            }

            return true;
        } catch (e) {
            console.error('Error in isValid:', e, {row, col});
            return false;
        }
    }

    function solve(row) {
        try {
            if (row >= boardSize) {
                // 检查每个区域是否都有一个皇后
                for (let [region, count] of regionQueens) {
                    if (count !== 1) {
                        return false;
                    }
                }
                return true;
            }

            for (let col = 0; col < boardSize; col++) {
                if (isValid(row, col)) {
                    // 放置皇后
                    board[row][col] = 1;
                    cols.add(col);
                    diag1.add(row + col);
                    diag2.add(row - col);
                    let region = colorRegions[row][col];
                    regionQueens.set(region, regionQueens.get(region) + 1);

                    if (solve(row + 1)) {
                        return true;
                    }

                    // 回溯
                    board[row][col] = 0;
                    cols.delete(col);
                    diag1.delete(row + col);
                    diag2.delete(row - col);
                    regionQueens.set(region, regionQueens.get(region) - 1);
                }
            }
            return false;
        } catch (e) {
            console.error('Error in solve:', e, {row});
            return false;
        }
    }

    try {
        if (solve(0)) {
            return board;
        }
        console.log('No solution found');
        return null;
    } catch (e) {
        console.error('Error in solveQueens:', e);
        return null;
    }
}

// HSV 转 RGB 函数
function hsvToRgb(h, s, v) {
    let r, g, b;
    
    // 将色相转换到 0-360 范围
    h = h % 360;
    if (h < 0) h += 360;
    
    // 将饱和度和亮度转换到 0-1 范围
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));

    let c = v * s;
    let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let m = v - c;

    if (h < 60) {
        [r, g, b] = [c, x, 0];
    } else if (h < 120) {
        [r, g, b] = [x, c, 0];
    } else if (h < 180) {
        [r, g, b] = [0, c, x];
    } else if (h < 240) {
        [r, g, b] = [0, x, c];
    } else if (h < 300) {
        [r, g, b] = [x, 0, c];
    } else {
        [r, g, b] = [c, 0, x];
    }

    // 转换到 0-255 范围并返回
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255)
    ];
} 