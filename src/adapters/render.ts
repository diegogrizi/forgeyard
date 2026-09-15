import { readFile } from "node:fs/promises";

import type { PlannedFile, ResolvedComponent } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { renderStrictTemplate } from "./strict-template.js";

function renderingError(message: string, componentId: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Reload the registry and correct the component source or adapter mapping.",
    exitCode: 3,
    components: [componentId],
  });
}

export async function renderComponent(
  component: ResolvedComponent,
  targetPath: string,
  variables: Readonly<Record<string, string>>,
): Promise<PlannedFile> {
  const source = (await readFile(component.sourcePath, "utf8")).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (sha256Text(source) !== component.sha256) {
    throw renderingError(`Component '${component.id}' changed after registry resolution.`, component.id);
  }

  let content: string;
  if (component.template) {
    content = renderStrictTemplate(source, variables);
  } else {
    if (Object.keys(variables).length > 0) {
      throw renderingError(`Non-template component '${component.id}' received rendering variables.`, component.id);
    }
    content = source;
  }

  return {
    path: targetPath,
    content,
    sha256: sha256Text(content),
    componentId: component.id,
    ownership: component.ownership,
  };
}
