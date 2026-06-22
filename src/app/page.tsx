import CommandCenter from "./command-center";
import DiscoverDashboard from "./discover-dashboard";
import TrendingSounds from "./trending-sounds";
import LoopPanels from "./loop-panels";
import DashboardPanels from "./dashboard-panels";
import { PipelineRail, Stage } from "./pipeline";

export default function Home() {
  return (
    <>
      <CommandCenter />
      <PipelineRail />
      <div className="space-y-10 py-8">
        <Stage n={1} id="discover">
          <DiscoverDashboard />
          <div className="mt-8">
            <TrendingSounds />
          </div>
        </Stage>
        <Stage n={2} id="observe">
          <LoopPanels />
        </Stage>
        <DashboardPanels />
      </div>
    </>
  );
}
