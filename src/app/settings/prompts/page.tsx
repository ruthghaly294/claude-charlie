import PromptsEditor from "./prompts-editor";
import VariantsManager from "./variants-manager";

export default function PromptsSettingsPage() {
  return (
    <>
      <PromptsEditor />
      <div className="mx-auto max-w-[900px] px-4">
        <hr className="border-neutral-800" />
      </div>
      <VariantsManager />
    </>
  );
}
