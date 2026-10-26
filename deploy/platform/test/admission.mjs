// Classifies the output of `kubectl apply` for a pod whose admission was refused.
// 'policy-denial'  Kyverno's require-signed-images rejected the image for lacking a signature
// 'infra-error'    registry/network trouble: proves nothing about the policy
// 'other'          anything else
// Also usable as a CLI: reads stdin, prints the class, exits 0 only for 'policy-denial'.
export function classifyDenial(text) {
  if (/require-signed-images/i.test(text) && /no signatures found/i.test(text)) return 'policy-denial';
  if (/connection refused|no such host|dial tcp|i\/o timeout|MANIFEST_UNKNOWN|NAME_UNKNOWN|failed to (?:fetch|resolve)|unauthorized|x509|TLS handshake|EOF/i.test(text)) {
    return 'infra-error';
  }
  return 'other';
}

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const kind = classifyDenial(readFileSync(0, 'utf8'));
  console.log(kind);
  process.exit(kind === 'policy-denial' ? 0 : 1);
}
