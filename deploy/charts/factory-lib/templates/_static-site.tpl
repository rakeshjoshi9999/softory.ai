{{/* Static site served by nginx-unprivileged: port 8080, probes on /. */}}
{{- define "factory-lib.static-site" -}}
{{- include "factory-lib.workload" (dict "ctx" . "port" 8080 "healthPath" "/" "uid" 101) -}}
{{- end -}}
