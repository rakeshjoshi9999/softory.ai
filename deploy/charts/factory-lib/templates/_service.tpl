{{/* NestJS-style API workload: port from .Values.port (default 3000), probes on /health. */}}
{{- define "factory-lib.service" -}}
{{- include "factory-lib.workload" (dict "ctx" . "port" (default 3000 .Values.port) "healthPath" (default "/health" .Values.healthPath)) -}}
{{- end -}}
