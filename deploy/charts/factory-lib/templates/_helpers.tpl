{{- define "factory-lib.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "factory-lib.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "factory-lib.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "factory-lib.labels" -}}
app.kubernetes.io/name: {{ include "factory-lib.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: software-factory
{{- end -}}

{{- define "factory-lib.selectorLabels" -}}
app.kubernetes.io/name: {{ include "factory-lib.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Shared pod spec body. Expects a dict: ctx (root context), port, healthPath. */}}
{{- define "factory-lib.container" -}}
- name: {{ include "factory-lib.name" .ctx }}
  image: "{{ .ctx.Values.image.repository }}:{{ .ctx.Values.image.tag }}"
  imagePullPolicy: {{ .ctx.Values.image.pullPolicy }}
  ports:
    - name: http
      containerPort: {{ .port }}
  livenessProbe:
    httpGet:
      path: {{ .healthPath }}
      port: http
    initialDelaySeconds: 5
    periodSeconds: 10
  readinessProbe:
    httpGet:
      path: {{ .healthPath }}
      port: http
    periodSeconds: 5
  resources:
    {{- toYaml .ctx.Values.resources | nindent 4 }}
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    runAsNonRoot: true
    capabilities:
      drop: ["ALL"]
  volumeMounts:
    - name: tmp
      mountPath: /tmp
{{- end -}}

{{- define "factory-lib.workload" -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "factory-lib.fullname" .ctx }}
  labels:
    {{- include "factory-lib.labels" .ctx | nindent 4 }}
spec:
  replicas: {{ .ctx.Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "factory-lib.selectorLabels" .ctx | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "factory-lib.selectorLabels" .ctx | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        {{- include "factory-lib.container" . | nindent 8 }}
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "factory-lib.fullname" .ctx }}
  labels:
    {{- include "factory-lib.labels" .ctx | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "factory-lib.selectorLabels" .ctx | nindent 4 }}
  ports:
    - name: http
      port: 80
      targetPort: http
{{- end -}}
