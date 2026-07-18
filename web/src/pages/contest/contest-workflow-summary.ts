import type { ContestCanvasSnapshot } from "@/services/api/contest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type ContestWorkflowSummary = {
    nodes: number;
    connections: number;
    images: number;
    videos: number;
    audios: number;
    references: number;
    models: string[];
    parameters: string[];
};

export function summarizeContestWorkflow(snapshot: ContestCanvasSnapshot): ContestWorkflowSummary {
    const nodes = (snapshot.nodes ?? []) as CanvasNodeData[];
    const models = new Set<string>();
    const parameters = new Set<string>();
    let images = 0;
    let videos = 0;
    let audios = 0;
    let references = 0;

    for (const node of nodes) {
        if (node.type === CanvasNodeType.Image) images += 1;
        if (node.type === CanvasNodeType.Video) videos += 1;
        if (node.type === CanvasNodeType.Audio) audios += 1;
        const metadata = node.metadata;
        if (!metadata) continue;
        if (metadata.model) models.add(metadata.model);
        references += metadata.references?.length ?? 0;
        if (metadata.size) parameters.add(metadata.size);
        if (metadata.quality) parameters.add(metadata.quality);
        if (metadata.vquality) parameters.add(`${metadata.vquality}p`);
        if (metadata.seconds) parameters.add(`${metadata.seconds}s`);
    }

    return {
        nodes: nodes.length,
        connections: snapshot.connections?.length ?? 0,
        images,
        videos,
        audios,
        references,
        models: Array.from(models),
        parameters: Array.from(parameters),
    };
}
