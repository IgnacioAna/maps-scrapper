# Backlog SCM Dental

Ideas que NO están priorizadas para construir ahora pero que vale la pena tener anotadas. Si en algún momento aparece el tiempo / la necesidad, se sacan de acá.

---

## 1. ICP en lenguaje natural para la búsqueda

**Qué:** reemplazar (o complementar) los dropdowns de país+ciudad por un cuadro de texto donde el admin describe el lead ideal en español:

> *"Dentistas en Madrid centro con más de 50 reseñas en Google, que tengan Instagram pero no tengan web propia, y al menos 3 años activos."*

Una IA (Mercury o Qwen, que ya están integradas) lo descompone a un JSON estructurado `{country, city, queryTerms, filters:{minReviews, hasWeb, hasInstagram, ...}}` y se lo pasa al pipeline de scraping y filtros que ya existe.

**Por qué:** acelera mucho probar ICPs nuevos (hoy es un click-fest); permite combinaciones que ningún dropdown ofrece; el setter/admin piensa en cliente, no en filtros.

**Cuándo cobra sentido:** cuando se escalen campañas a múltiples nichos/países en paralelo, o cuando haya varios setters con ICPs distintos.

**Estimación:** ~1 día de trabajo (un endpoint que llame a Mercury para parsear + cableado al frontend de Búsqueda).

**Anotado:** 2026-05-29, sesión call center.
