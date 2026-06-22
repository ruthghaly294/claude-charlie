"use client";

import { useState } from "react";
import ResearchPanel, { type DraftSeed } from "./research-panel";
import BufferPanel from "./buffer-panel";
import ContentQueue from "./content-queue";
import { Stage } from "./pipeline";

export default function DashboardPanels() {
  const [draft, setDraft] = useState<DraftSeed | null>(null);

  return (
    <>
      <Stage n={3} id="content-queue">
        <ContentQueue />
      </Stage>
      <Stage n={4} id="research">
        <ResearchPanel onDraft={setDraft} />
      </Stage>
      <Stage n={5} id="publish" last>
        <BufferPanel draft={draft} />
      </Stage>
    </>
  );
}
