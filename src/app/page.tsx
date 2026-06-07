import CommandCenter from "./command-center";
import DiscoverDashboard from "./discover-dashboard";
import LoopPanels from "./loop-panels";

export default function Home() {
  return (
    <>
      <CommandCenter />
      <DiscoverDashboard />
      <LoopPanels />
    </>
  );
}
