import * as THREE from 'three';

export class DynamicLineSegments extends THREE.LineSegments {
    private count: number;
    private buffer: ArrayBuffer;
    private idxToPosition: Map<number, number> = new Map();
    private positionToId: Map<number, number> = new Map();
    private nextLineIdx: number = 0;

    private drawStart: number | undefined;
    private drawEnd: number | undefined;

    constructor(material: THREE.Material, initialPoints = 100) {
        // Setup the buffer (3 floats per vertex, 2 vertices per line, 4 bytes per float)
        const initialBytes = initialPoints * 2 * 3 * 4;

        let buffer = new ArrayBuffer(initialBytes);
        let positions = new Float32Array(buffer);

        const geometry = new THREE.BufferGeometry();
        const positionAttr = new THREE.BufferAttribute(positions, 3);
        positionAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', positionAttr);

        // Start with 0 visible lines
        geometry.setDrawRange(0, 0);

        super(geometry, material);

        this.count = 0;
        this.buffer = buffer;
    }

    addLine(start: THREE.Vector3Like, end: THREE.Vector3Like, doUpdateGraphics: boolean = true): number {
        const attr = this.geometry.attributes.position;
        const requiredIndices = this.count + 2;

        if (requiredIndices > attr.array.length / 3) {
            this.growBuffer();
        }

        attr.setXYZ(this.count, start.x, start.y, start.z);
        attr.setXYZ(this.count + 1, end.x, end.y, end.z);

        const lineIdx = this.nextLineIdx++;
        this.idxToPosition[lineIdx] = this.count;
        this.positionToId[this.count] = lineIdx;
        this.count += 2;

        if (doUpdateGraphics) {
            this.updateGraphics()
        }

        return lineIdx;
    }

    addLineSegments(points: THREE.Vector3Like[], doUpdateGraphics: boolean = true): number[] {
        const indices = []
        for (let i = 0; i < points.length - 1; i++) {
            indices.push(this.addLine(points[i], points[i + 1], false))
        }

        if (doUpdateGraphics) {
            this.updateGraphics()
        }

        return indices
    }

    removeLine(lineIdx: number): boolean {
        const position = this.idxToPosition.get(lineIdx)
        if (!position) {
            return false;
        }

        const attr = this.geometry.attributes.position;
        const lastPosition = this.count - 2;
        if (position && position == lastPosition) {
            // Move the last line entry to the removed line in the array
            attr.setXYZ(position, attr.getX(lastPosition), attr.getY(lastPosition), attr.getZ(lastPosition))
            const nextLastPosition = lastPosition + 1
            attr.setXYZ(position + 1, attr.getX(nextLastPosition), attr.getY(nextLastPosition), attr.getZ(nextLastPosition))

            // Update mappings
            const lastId = this.positionToId[lastPosition];
            this.idxToPosition[lastId] = position;
            this.positionToId[position] = lastId
        }

        this.idxToPosition.delete(lineIdx);
        this.positionToId.delete(lastPosition);
        this.count -= 2;

        this.updateGraphics();

        return true;
    }

    setDrawRange(startIdx: number, endIdx: number) {
        this.drawStart = this.idxToPosition[startIdx]
        this.drawEnd = this.idxToPosition[endIdx];
        this.geometry.setDrawRange(this.drawStart ?? 0, this.drawEnd ?? this.count);
        this.geometry.computeBoundingSphere();
    }

    private updateGraphics() {
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.setDrawRange(this.drawStart ?? 0, this.drawEnd ?? this.count);
        this.geometry.computeBoundingSphere()
    }

    private growBuffer() {
        const currentByteLength = this.buffer.byteLength;
        let newByteLength = currentByteLength * 2;

        if (newByteLength > this.buffer.maxByteLength) {
            // If we exceed maxByteLength, we must transfer to a brand new buffer
            // and set a new, higher maxByteLength
            const nextMax = this.buffer.maxByteLength * 2;
            this.buffer = this.buffer.transfer ?
                this.buffer.transfer(newByteLength) :
                this.manualTransfer(newByteLength, nextMax);
        }

        const newArray = new Float32Array(this.buffer);
        const newAttr = new THREE.BufferAttribute(newArray, 3);
        newAttr.setUsage(THREE.DynamicDrawUsage);

        this.geometry.setAttribute('position', newAttr);

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeBoundingSphere()
    }

    private manualTransfer(newSize: number, nextMax: number): ArrayBuffer {
        const newBuf = new ArrayBuffer(newSize, { maxByteLength: nextMax });
        new Uint8Array(newBuf).set(new Uint8Array(this.buffer));
        return newBuf;
    }
}