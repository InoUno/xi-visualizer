import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

export interface RayHit {
    x: number;
    y: number;
    z: number;
    index?: number;
    faceIndex?: number;
    instanceId?: number;
    object: THREE.Object3D,
    face?: {
        a: number;
        b: number;
        c: number;
    }
}


// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;


const neutralColor = new THREE.Color(0.7, 0.7, 0.7);
const neutralColorArr = [neutralColor.r * 255, neutralColor.g * 255, neutralColor.b * 255];

const markedColor = new THREE.Color(1, 0, 0);
const markedColorArr = [markedColor.r * 255, markedColor.g * 255, markedColor.b * 255];

const colorCheckedCells = new THREE.Color(0.1, 1, 1);
const colorCheckedCellEntries = new THREE.Color(0.1, 0.1, 1);
const colorCheckedTriangles = new THREE.Color(1, 1, 0.1);
const colorHitTriangles = new THREE.Color(1, 0.1, 0.1);

const META_SIZE = 6;
const HEADER_SIZE = 20;

function alignSize(size: number) {
    return size + ((4 - (size & 3)) & 3);
}

function parseMeshBlock(buffer: ArrayBufferLike, data: DataView, blockOffset: number) {
    const verticesCount = data.getUint16(blockOffset, true);
    const trianglesCount = data.getUint16(blockOffset + 2, true);
    const barrierFlag = data.getUint16(blockOffset + 4, true);

    const verticesOffset = blockOffset + 8;
    const indicesOffset = alignSize(verticesOffset + verticesCount * 3 * 4);
    const metasOffset = alignSize(indicesOffset + trianglesCount * 3 * 2);

    let positions = new Float32Array(buffer, verticesOffset, verticesCount * 3);
    let indices = new Uint16Array(buffer, indicesOffset, trianglesCount * 3);
    let metas = new Uint8Array(buffer, metasOffset, trianglesCount);

    return {
        indices,
        positions,
        metas,
        hasBarriers: barrierFlag > 0,
    };
}

interface EntryInfo {
    cellIdx: number;
    entryIdx: number;
    indices: Uint16Array;
    positions: Float32Array;
    placementOffset: number;
    placement: PreparedPlacementData;
    blockOffset: number;
    block: BlockInfo;
}

export function createZoneMesh(zoneId: number, buffer: ArrayBufferLike, prep: PreparedMeshData, colorKind: ColorKind) {
    console.time("setup-mesh-" + zoneId);

    const header = new Uint16Array(buffer, 0, 2);
    const cellCount = header[0] * header[1];
    const data = new DataView(buffer);

    let entries: EntryInfo[] = []
    let meshIndicesCount = 0

    let currentLookupOffset = HEADER_SIZE;
    for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
        const cellDataOffset = data.getUint32(currentLookupOffset, true);
        currentLookupOffset += 4;
        if (cellDataOffset == 0) {
            continue;
        }

        let offset = cellDataOffset;

        offset += 4;
        const entryCount = data.getUint16(offset, true);
        offset += 2;

        for (let entryIdx = 0; entryIdx < entryCount; entryIdx++) {
            const blockOffset = data.getUint32(offset, true);
            const placementOffset = data.getUint32(offset + 4, true);
            offset += 8;

            // Check if it's a new placement, and create it if so
            if (!prep.placement[placementOffset]) {
                throw Error(`Missing placement in prepared data: ${placementOffset}`);
            }

            // Check if it's a new block, and create it if so
            if (!prep.block[blockOffset]) {
                throw Error(`Missing block in prepared data: ${blockOffset}`);
            }

            const indices = prep.block[blockOffset].indices;
            meshIndicesCount += indices.length;

            const positions = prep.block[blockOffset].positions;

            entries.push({
                cellIdx,
                entryIdx,
                indices,
                positions,
                placementOffset,
                placement: prep.placement[placementOffset],
                blockOffset,
                block: prep.block[blockOffset],
            });
        }
    }

    // Make one vertex per index in ximesh, making in a non-indexed geometry
    let positions = new Float32Array(meshIndicesCount * 3);
    let meta = new Uint32Array(meshIndicesCount * META_SIZE);
    let colors = new Uint8Array(meshIndicesCount * 3);

    let metaOffset = 0;
    let posOffset = 0;
    let vec = new THREE.Vector3(0, 0, 0);
    for (const entry of entries) {

        let v1Offset = 0;
        let v3Offset = 2;
        if (entry.placement.o2w.determinant() > 0) {
            v1Offset = 2;
            v3Offset = 0;
        }

        for (let i = 0; i < entry.indices.length; i += 3) {
            const triangleIdx = i / 3;
            const triangleMeta = entry.block.metas[triangleIdx];

            const vertexIndices = [entry.indices[i + v1Offset], entry.indices[i + 1], entry.indices[i + v3Offset]];
            for (const vIdx of vertexIndices) {
                const offset = vIdx * 3;
                vec.set(entry.positions[offset], entry.positions[offset + 1], entry.positions[offset + 2]);
                vec.applyMatrix4(entry.placement.o2w);
                positions.set(vec.toArray(), posOffset);
                posOffset += 3;

                // Amount of meta inserts should match META_SIZE
                meta[metaOffset++] = entry.cellIdx;
                meta[metaOffset++] = entry.entryIdx;
                meta[metaOffset++] = triangleIdx;
                meta[metaOffset++] = entry.blockOffset;
                meta[metaOffset++] = entry.placementOffset;
                meta[metaOffset++] = triangleMeta;
            }
        }
    }

    let geo = new THREE.BufferGeometry();

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("meta", new THREE.BufferAttribute(meta, META_SIZE));

    const colorsAttr = geo.getAttribute("color");
    const colorFn = getColorKindFunc(geo.getAttribute("meta"), prep, colorKind);
    for (let vIdx = 0; vIdx < colorsAttr.count; vIdx++) {
        colorsAttr.array.set(colorFn(vIdx), vIdx * 3);
    }

    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundsTree();

    const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
        vertexColors: true,
        side: THREE.FrontSide,
    });

    const lineMaterial = new THREE.MeshPhongMaterial({
        color: 0x333333,
        transparent: true,
        wireframe: true,
        opacity: 0.10,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.markedTriangles = {};
    mesh.userData.colorFn = colorFn;
    mesh.userData.colorKind = colorKind;

    const wireframe = new THREE.Mesh(geo, lineMaterial);
    mesh.add(wireframe);

    console.timeEnd("setup-mesh-" + zoneId);
    return mesh;
}

export function prepareMeshData(buffer: ArrayBufferLike): PreparedMeshData {
    const header = new Uint16Array(buffer, 0, 2);
    const cellCount = header[0] * header[1];

    const data = new DataView(buffer);

    const isWideSearch = data.getUint32(16, true) > 0;
    console.log("Wide search:", isWideSearch);

    const result: PreparedMeshData = {
        placement: {},
        block: {},
        cell: {},
        cellEntry: {},
        isWideSearch,
    };


    for (let cellIdx = 0; cellIdx < cellCount; cellIdx++) {
        const cellDataOffset = data.getUint32(HEADER_SIZE + cellIdx * 4, true);
        if (cellDataOffset == 0) {
            continue;
        }

        let cellYMax = -1e6;
        let cellYMin = 1e6;

        let offset = cellDataOffset;

        offset += 4;
        const entryCount = data.getUint16(offset, true);
        offset += 2;

        for (let entryIdx = 0; entryIdx < entryCount; entryIdx++) {
            const blockOffset = data.getUint32(offset, true);
            const placementOffset = data.getUint32(offset + 4, true);
            offset += 8;

            // Check if it's a new placement, and create it if so
            if (!result.placement[placementOffset]) {
                const placeData = data.getUint32(placementOffset, true);

                const o2wOffset = placementOffset + 4;
                const o2w = new THREE.Matrix4(
                    data.getFloat32(o2wOffset + 0, true), data.getFloat32(o2wOffset + 12, true), data.getFloat32(o2wOffset + 24, true), data.getFloat32(o2wOffset + 36, true),
                    data.getFloat32(o2wOffset + 4, true), data.getFloat32(o2wOffset + 16, true), data.getFloat32(o2wOffset + 28, true), data.getFloat32(o2wOffset + 40, true),
                    data.getFloat32(o2wOffset + 8, true), data.getFloat32(o2wOffset + 20, true), data.getFloat32(o2wOffset + 32, true), data.getFloat32(o2wOffset + 44, true),
                    0, 0, 0, 1,
                );

                const w2o = o2w.clone().invert();

                result.placement[placementOffset] = {
                    o2w,
                    w2o,
                    yMax: -1e6,
                    yMin: 1e6,
                    placeData,
                }
            }

            // Check if it's a new block, and create it if so
            if (!result.block[blockOffset]) {
                result.block[blockOffset] = parseMeshBlock(buffer, data, blockOffset);
            }

            const placement = result.placement[placementOffset];
            const block = result.block[blockOffset];

            for (let i = 0; i < block.positions.length; i += 3) {
                const vec = new THREE.Vector3(block.positions[i], block.positions[i + 1], block.positions[i + 2]);
                vec.applyMatrix4(placement.o2w);
                const value = vec.y;
                if (value > cellYMax) {
                    cellYMax = value;
                }
                if (value < cellYMin) {
                    cellYMin = value;
                }
            }

            result.cell[cellIdx] = {
                yMin: cellYMin,
                yMax: cellYMax,
            };

            if (cellYMax > placement.yMax) {
                placement.yMax = cellYMax;
            }
            if (cellYMin < placement.yMin) {
                placement.yMin = cellYMin;
            }
        }

        result.cell[cellIdx] = {
            yMin: cellYMin,
            yMax: cellYMax,
        };

    }

    return result;
}

export const enum ColorKind {
    None,
    Barriers,
    Materials,
    Maps,
    IsRoofed,
}

function getColorKindFunc(metas: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, prep: PreparedMeshData, kind: ColorKind) {
    switch (kind) {
        case ColorKind.Barriers:
            return (vIdx: number) => {
                const blockOffset = metas.array[vIdx * META_SIZE + 3];
                const block = prep.block[blockOffset];

                const triangleMeta = metas.array[vIdx * META_SIZE + 5];

                let colorFlag = 0;
                if (triangleMeta & 0x10) {
                    // Has barrier flag
                    colorFlag |= 1;
                }
                if (block.hasBarriers) {
                    colorFlag |= 2;
                }

                if (colorFlag > 0) {
                    switch (colorFlag) {
                        case 1:
                            return [0, 0, 255] // Blue
                        case 2:
                            return [255, 50, 200] // Purple
                        case 3:
                            return [255, 40, 10] // Orange
                    }
                }

                return neutralColorArr;
            };

        case ColorKind.Maps:
            const mapColors = [
                [200, 200, 200], // White
                [255, 50, 50], // Red
                [50, 255, 50], // Green
                [50, 50, 255], // Blue
                [255, 40, 10], // Orange
                [255, 50, 200], // Purple
                [255, 10, 40], // Pink
                [10, 40, 255],
                [40, 10, 255],
                [10, 255, 40],
                [40, 255, 10],
            ];
            let assignedColors: { [mapId: number]: number[] } = {};

            return (vIdx: number) => {
                const placementOffset = metas.array[vIdx * META_SIZE + 4];
                const placement = prep.placement[placementOffset];

                const mapId = (placement.placeData >> 0x1A & 3) << 3 | placement.placeData >> 3 & 7

                const color = assignedColors[mapId];
                if (color) {
                    return color;
                }

                assignedColors[mapId] = mapColors[Object.keys(assignedColors).length % mapColors.length]
                return assignedColors[mapId];
            };

        case ColorKind.Materials:
            const materialColors = {
                0: [255, 40, 10], // Barriers
                1: [147, 132, 84], // Path, gravel, ground
                2: [67, 158, 73], // Grass, ground
                3: [222, 224, 121], // Sand
                4: [200, 200, 200], // Snow
                5: [91, 88, 85], // Stone, hill
                6: [171, 104, 216], // Promyvion ground
                7: [155, 89, 7], // Wood
                8: [50, 100, 255], // Certain water (shallow, waterfall, beach waves)
                9: [30, 50, 255], // Water
                10: [255, 0, 0],
                11: [255, 0, 0],
                12: [255, 0, 0],
                13: [255, 0, 0],
                14: [255, 0, 0],
                15: [255, 0, 0],
            } as { [matIdx: number]: number[] };

            return (vIdx: number) => {
                const triangleMeta = metas.array[vIdx * META_SIZE + 5];
                const material = triangleMeta & 0xF;
                return materialColors[material];
            };

        case ColorKind.IsRoofed:
            return (vIdx: number) => {
                const placementOffset = metas.array[vIdx * META_SIZE + 4];
                const placement = prep.placement[placementOffset];

                const isRoofed = (placement.placeData >> 2 & 1) > 0

                return isRoofed ? [255, 50, 10] : neutralColorArr;
            };
        default:
            break;
    }

    return (_vIdx: number) => {
        return neutralColorArr;
    };

}

export function colorMesh(mesh: THREE.Mesh, prep: PreparedMeshData, kind: ColorKind) {
    if (mesh.userData.colorKind == kind) {
        return;
    }

    const colors = mesh.geometry.getAttribute("color");
    const metas = mesh.geometry.getAttribute("meta");
    const colorFn = getColorKindFunc(metas, prep, kind);

    for (let vIdx = 0; vIdx < colors.count; vIdx++) {
        colors.array.set(colorFn(vIdx), vIdx * 3);
    }

    mesh.userData.colorFn = colorFn;
    mesh.userData.colorKind = kind;

    colors.needsUpdate = true;
}

export interface HitData {
    hit: RayHit;
    cellIdx: number;
    entryIdx: number;
    block: BlockInfo;
    placement: PreparedPlacementData;
    material: number;
}

export function getHitData(mesh: THREE.Mesh, buffer: ArrayBufferLike, prep: PreparedMeshData, hits: RayHit[]) {
    const meta = mesh.geometry.getAttribute("meta");
    const data = new DataView(buffer);

    const results: HitData[] = [];
    for (const hit of hits) {
        const face = hit.face!;
        const idx = face.a * META_SIZE;
        const cellIdx = meta.array[idx];
        const entryIdx = meta.array[idx + 1];

        const cellDataOffset = data.getUint32(HEADER_SIZE + cellIdx * 4, true);
        if (cellDataOffset == 0) {
            continue;
        }

        const entryOffset = cellDataOffset + 6 + 8 * entryIdx;
        const blockOffset = data.getUint32(entryOffset, true);
        const placementOffset = data.getUint32(entryOffset + 4, true);
        const block = prep.block[blockOffset];
        const placement = prep.placement[placementOffset];

        results.push({ hit, cellIdx, entryIdx, block, placement, material: meta.getComponent(hit.face?.a!, 5) & 0xF })
    }

    return results;
}

export function markHits(mesh: THREE.Mesh, hits: RayHit[]) {
    const colors = mesh.geometry.getAttribute("color");

    for (const hit of hits) {
        const face = hit.face!;
        colors.array.set(markedColorArr, face.a * 3);
        colors.array.set(markedColorArr, face.b * 3);
        colors.array.set(markedColorArr, face.c * 3);

        mesh.userData.markedTriangles[face.a] = true;
        mesh.userData.markedTriangles[face.b] = true;
        mesh.userData.markedTriangles[face.c] = true;
    }

    colors.needsUpdate = true;
}

function clearPreviousMarked(mesh: THREE.Mesh) {
    const colors = mesh.geometry.getAttribute("color");
    const colorFn = mesh.userData.colorFn ?? (() => neutralColorArr);
    for (const vertexIndex in mesh.userData.markedTriangles) {
        colors.array.set(colorFn(parseInt(vertexIndex) / 3), parseInt(vertexIndex));
    }
    colors.needsUpdate = true;
    mesh.userData.markedTriangles = {};
}

export function markGridEntries(mesh: THREE.Mesh, markerSet: MarkerSet, color: THREE.Color) {
    const colors = mesh.geometry.getAttribute("color");
    const meta = mesh.geometry.getAttribute("meta");
    const colorArr = [color.r * 255, color.g * 255, color.b * 255];

    for (let i = 0; i < meta.array.length; i += META_SIZE) {
        const cells = markerSet[meta.array[i]];
        if (!cells) {
            continue;
        }
        let markVertex = false;
        if (Object.keys(cells).length == 0) {
            markVertex = true;
        } else {
            const entries = cells[meta.array[i + 1]];
            if (!entries) {
                continue;
            }
            if (entries.size == 0 || entries.has(meta.array[i + 2])) {
                markVertex = true;
            }
        }

        if (markVertex) {
            const vertexIdx = i / META_SIZE;
            colors.array.set(colorArr, vertexIdx * 3);
            mesh.userData.markedTriangles[vertexIdx * 3] = true;
        }
    }

    colors.needsUpdate = true;
}

type MarkerSet = {
    [cellIdx: number]: {
        [entryIdx: number]: Set<number>,
    }
};

export function markLineCollisions(mesh: THREE.Mesh, buffer: ArrayBufferLike, prep: PreparedMeshData, start: THREE.Vector3, end: THREE.Vector3) {
    clearPreviousMarked(mesh);

    console.time("ray-intersection");
    const intersections = rayIntersections(buffer, prep, start, end);
    console.timeEnd("ray-intersection");
    console.log(intersections);

    let entries: MarkerSet = {};

    for (const gridIdx of intersections.potentialCellIndices) {
        entries[gridIdx] = {};
    }
    markGridEntries(mesh, entries, colorCheckedCells);

    entries = {};
    for (const info of intersections.checkedCellEntries) {
        if (!entries[info.cellIdx]) {
            entries[info.cellIdx] = {};
        }
        entries[info.cellIdx][info.entryIdx] = new Set();
    }
    markGridEntries(mesh, entries, colorCheckedCellEntries);


    entries = {};
    for (const info of intersections.checkedTriangles) {
        if (!entries[info.cellIdx]) {
            entries[info.cellIdx] = {};
        }
        if (!entries[info.cellIdx][info.entryIdx]) {
            entries[info.cellIdx][info.entryIdx] = new Set();
        }
        entries[info.cellIdx][info.entryIdx].add(info.triIdx);
    }
    markGridEntries(mesh, entries, colorCheckedTriangles);

    entries = {};
    for (const info of intersections.hitTriangles) {
        if (!entries[info.cellIdx]) {
            entries[info.cellIdx] = {};
        }
        if (!entries[info.cellIdx][info.entryIdx]) {
            entries[info.cellIdx][info.entryIdx] = new Set();
        }
        entries[info.cellIdx][info.entryIdx].add(info.triIdx);
    }
    markGridEntries(mesh, entries, colorHitTriangles);
}

function rayIntersections(buffer: ArrayBufferLike, prep: PreparedMeshData, start: THREE.Vector3, end: THREE.Vector3): LineIntersectionResult {
    console.log("Checking ray", start, end);

    const header = new Uint16Array(buffer, 0, 2);
    const gridWidth = header[0];
    const gridHeight = header[1];

    const cells = getRayGridCells(start, end, gridWidth, gridHeight);

    const cellSearchDiff = prep.isWideSearch ? 2 : 1;

    let potentialCellIndices: Set<number> = new Set();
    for (const cell of cells) {
        for (let dRow = -cellSearchDiff; dRow <= cellSearchDiff; dRow++) {
            for (let dCol = -cellSearchDiff; dCol <= cellSearchDiff; dCol++) {
                potentialCellIndices.add((cell.row + dRow) * gridWidth + cell.col + dCol);
            }
        }
    }

    const yMax = start.y > end.y ? start.y : end.y;
    const yMin = start.y > end.y ? end.y : start.y;

    let checkedCellEntries: CellEntryIdx[] = [];
    let checkedTriangles: TriangleId[] = [];
    let hitTriangles: TriangleId[] = [];

    let v1 = new THREE.Vector3();
    let v2 = new THREE.Vector3();
    let v3 = new THREE.Vector3();
    let startO = new THREE.Vector3();
    let endO = new THREE.Vector3();
    let diffO = new THREE.Vector3();
    let ray = new THREE.Ray();
    let intersect = new THREE.Vector3();

    const data = new DataView(buffer);
    for (const cellIdx of potentialCellIndices) {
        const cellDataOffset = data.getUint32(HEADER_SIZE + cellIdx * 4, true);
        if (cellDataOffset == 0) {
            continue;
        }

        const prepCell = prep.cell[cellIdx];
        if (yMin > prepCell.yMax || yMax < prepCell.yMin) {
            // Skipping cell entry, since none of the triangles meet the requirements on the y-axis.
            continue;
        }
        let offset = cellDataOffset;

        offset += 4;
        const entryCount = data.getUint16(offset, true);
        offset += 2;

        for (let entryIdx = 0; entryIdx < entryCount; entryIdx++) {
            const blockOffset = data.getUint32(offset, true);
            const placementOffset = data.getUint32(offset + 4, true);
            offset += 8;

            const placement = prep.placement[placementOffset]
            if (!placement) {
                console.error("Missing prepared placement data at", placementOffset);
                continue;
            }

            if (yMin > placement.yMax || yMax < placement.yMin) {
                // Skipping cell entry, since none of the triangles meet the requirements on the y-axis.
                continue;
            }

            checkedCellEntries.push({ cellIdx, entryIdx });

            // Check if it's a new block, and create it if so
            if (!prep.block[blockOffset]) {
                prep.block[blockOffset] = parseMeshBlock(buffer, data, blockOffset);
            }

            startO.copy(start).applyMatrix4(placement.w2o);
            endO.copy(end).applyMatrix4(placement.w2o);
            diffO.subVectors(endO, startO);

            ray.set(startO, diffO);

            const block = prep.block[blockOffset];
            for (let i = 0; i < block.indices.length; i += 3) {
                const v1Idx = block.indices[i] * 3;
                v1.x = block.positions[v1Idx];
                v1.y = block.positions[v1Idx + 1];
                v1.z = block.positions[v1Idx + 2];

                const v2Idx = block.indices[i + 1] * 3;
                v2.x = block.positions[v2Idx];
                v2.y = block.positions[v2Idx + 1];
                v2.z = block.positions[v2Idx + 2];

                const v3Idx = block.indices[i + 2] * 3;
                v3.x = block.positions[v3Idx];
                v3.y = block.positions[v3Idx + 1];
                v3.z = block.positions[v3Idx + 2];

                const result = placement.o2w.determinant() <= 0
                    ? ray.intersectTriangle(v1, v2, v3, true, intersect)
                    : ray.intersectTriangle(v3, v2, v1, true, intersect);

                const triRef = { cellIdx, entryIdx, triIdx: i / 3 };
                checkedTriangles.push(triRef);
                if (result) {
                    hitTriangles.push(triRef);
                    const worldIntersect = intersect.applyMatrix4(placement.o2w);
                    console.log("Intersected at", cellIdx, worldIntersect);
                }
            }
        }
    }

    return { potentialCellIndices, checkedCellEntries, checkedTriangles, hitTriangles };
}

// Ray-Grid Traversal using DDA with custom grid calculation
function getRayGridCells(start: THREE.Vector3, end: THREE.Vector3, gridWidth: number, gridHeight: number) {
    const cells: { col: number, row: number }[] = [];

    // Helper function to convert world coordinates to grid coordinates
    function worldToGrid(x: number, z: number) {
        const col = Math.floor(((gridWidth * 2) + x) / 4);
        const row = Math.floor(((gridHeight * 2) + z) / 4);
        return { col, row };
    }

    // Current grid cell coordinates
    let { row, col } = worldToGrid(start.x, start.z);

    // End grid cell coordinates
    const { row: endRow, col: endCol } = worldToGrid(end.x, end.z);

    // Direction of ray
    const dx = end.x - start.x;
    const dz = end.z - start.z;

    // Avoid division by zero
    if (Math.abs(dx) < 1e-10 && Math.abs(dz) < 1e-10) {
        return [{ col, row }];
    }

    // Which direction to step in (1 or -1)
    const stepCol = dx > 0 ? 1 : -1;
    const stepRow = dz > 0 ? 1 : -1;

    // Calculate delta distances (distance between grid lines in world units)
    // Since each grid cell is 4 units wide/tall
    const deltaX = Math.abs(dx) < 1e-10 ? Infinity : Math.abs(4 / dx);
    const deltaZ = Math.abs(dz) < 1e-10 ? Infinity : Math.abs(4 / dz);

    // Distance to next grid line
    let nextX = Infinity;
    let nextZ = Infinity;

    if (col != endCol) {
        if (dx > 0) {
            // Distance to right edge of current cell
            const rightEdge = (col + 1) * 4 - (gridWidth * 2);
            nextX = (rightEdge - start.x) / dx;
        } else if (dx < 0) {
            // Distance to left edge of current cell
            const leftEdge = col * 4 - (gridWidth * 2);
            nextX = (leftEdge - start.x) / dx;
        }
    }

    if (row != endRow) {
        if (dz > 0) {
            // Distance to bottom edge of current cell
            const bottomEdge = (row + 1) * 4 - (gridHeight * 2);
            nextZ = (bottomEdge - start.z) / dz;
        } else if (dz < 0) {
            // Distance to top edge of current cell
            const topEdge = row * 4 - (gridHeight * 2);
            nextZ = (topEdge - start.z) / dz;
        }
    }

    // Add starting cell
    cells.push({ col, row });

    while (col !== endCol || row !== endRow) {
        // Move to next grid line (whichever is closer)
        if (nextX < nextZ) {
            nextX += deltaX;
            col += stepCol;

            // If we're at the end grid column, then ensure we do not step further that way
            if (col == endCol) {
                nextX = Infinity;
            }
        } else {
            nextZ += deltaZ;
            row += stepRow;

            // If we're at the end grid row, then ensure we do not step further that way
            if (row == endRow) {
                nextZ = Infinity;
            }
        }

        cells.push({ col, row });

        // Safety check to prevent infinite loops
        if (cells.length >= 1000) {
            console.warn('Ray traversal exceeded maximum iterations');
            break;
        }
    }

    return cells;
}

export interface PreparedMeshData {
    placement: { [placementOffset: number]: PreparedPlacementData };
    block: { [blockOffset: number]: BlockInfo };
    cell: { [cellIdx: number]: YRange };
    cellEntry: { [cellIdx: number]: { [entryIdx: number]: YRange } };
    isWideSearch: boolean,
}

interface CellEntryIdx {
    cellIdx: number,
    entryIdx: number,
}

interface TriangleId {
    cellIdx: number,
    entryIdx: number,
    triIdx: number,
}

interface LineIntersectionResult {
    potentialCellIndices: Set<number>;
    checkedCellEntries: CellEntryIdx[];
    checkedTriangles: TriangleId[];
    hitTriangles: TriangleId[];
}

interface YRange {
    yMin: number,
    yMax: number,
}

export interface PreparedPlacementData {
    yMin: number,
    yMax: number,
    o2w: THREE.Matrix4,
    w2o: THREE.Matrix4,
    placeData: number,
}

export function getMapId(data: PreparedPlacementData): number {
    return ((data.placeData >> 0x1A & 3) << 3 | data.placeData >> 3 & 7)
}

export interface BlockInfo {
    indices: Uint16Array;
    positions: Float32Array;
    metas: Uint8Array,
    hasBarriers: boolean;
}
