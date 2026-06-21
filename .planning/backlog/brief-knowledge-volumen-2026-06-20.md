# Brief IA + conocimiento del equipo — evolución a futuro (con volumen)

> Anotado 2026-06-20 a pedido del user, para no olvidar cuando haya volumen de llamadas grabadas.

## Estado actual (HECHO 2026-06-20)
El Brief IA ya NO analiza a ciegas. `_briefKnowledge()` (index.js) inyecta en cada brief:
- El **system prompt de Mercury** (qué vendemos, a quién, cómo posicionamos).
- Los **feedbackNotes** (aprendizajes que el admin carga vía "Sugerir mejora" en Revisión IA).

Es conocimiento **destilado**, no transcripciones crudas. El volante de mejora HOY es:
admin ve una llamada/respuesta → "Sugerir mejora" → feedbackNote → entra en todos los
briefs y respuestas futuras. Cuantos más aprendizajes, más afinado.

## PENDIENTE — minado automático de transcripciones (hacer CON VOLUMEN)
Cuando haya un volumen razonable de llamadas grabadas/transcriptas (`lead.callLog[].transcript`),
construir un loop que:
1. Tome las transcripciones (anonimizadas) de un período.
2. Con la IA, extraiga PATRONES agregados: objeciones más frecuentes, frases que
   funcionaron para cerrar, ángulos que convirtieron, motivos de pérdida recurrentes.
3. Resuma eso en pocos "aprendizajes" y los inyecte automáticamente al conocimiento
   (mismo canal que feedbackNotes, o un bloque nuevo `minedInsights`).
4. Que el Brief IA + el Coach + las respuestas de Mercury usen esos insights.

### Por qué NO ahora
- Con pocas llamadas, los patrones son ruido.
- Meter transcripciones crudas en cada brief es inviable en tokens.
- El destilado (system prompt + feedbackNotes) ya cubre el caso hasta tener volumen.

### Disparador para retomar
Cuando `data/setters.json` tenga, digamos, 100+ llamadas con `transcript.segments`.
Ahí el minado empieza a valer la pena. Revisar la Biblioteca de llamadas (view-training-ai)
para ver cuántas hay transcriptas.

## Relacionado
- `_briefKnowledge()` / `_buildBriefMessages()` en index.js (donde se inyecta hoy).
- `mercury_config.json` feedbackNotes (los aprendizajes manuales).
- `_trainingSummaryLLM` / Biblioteca de llamadas (ya resume llamadas individuales).
