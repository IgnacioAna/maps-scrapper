import XLSX from 'xlsx';

const wb = XLSX.utils.book_new();

// =============================================
// HOJA 1: DEFINICION DE VARIANTES
// =============================================
const variantesData = [
  ['SCM DENTAL - CONTROL DE VARIANTES DE MENSAJE'],
  ['Cada variante se testea 3 dias. Al terminar, se registran metricas y se pasa a la siguiente.'],
  [],
  ['VAR', 'ASIGNADO A', 'TIPO', 'MSG 1 (Apertura)', 'MSG 2 (Problema)', 'MSG 3 (Prueba social)', 'MSG 4 (Pregunta cierre)', 'LINK DE APOYO', 'FECHA INICIO', 'FECHA FIN', 'ESTADO'],
  [
    'V1', 'Paula / Setter 2', 'PLURAL',
    'Que tal, gracias por responder.',
    'Les escribiamos porque estamos ayudando a clinicas dentales a recuperar pacientes que dejaron de venir. 6 de cada 10 pacientes nuevos nunca regresan despues de la primera visita y la mayoria de las clinicas no tiene ningun sistema para evitarlo.',
    'Con nuestro cliente mas reciente, solo en los primeros 10 dias activando su base, cerramos 28 citas de pacientes que hacia meses no volvian, de forma completamente automatica.',
    'Esto es algo que estan trabajando hoy?',
    'omni-pg.com/patient-retention-and-its-importance-in-dentistry',
    '', '', 'PENDIENTE'
  ],
  [
    'V2', 'Paula / Setter 2', 'PLURAL',
    'Que tal, gracias por responder.',
    'Les escribiamos porque estamos ayudando a clinicas dentales a reactivar su base de pacientes inactivos. Reactivar a alguien que ya conoce la clinica cuesta 5 veces menos que conseguir un paciente nuevo, y la mayoria tiene esa plata dormida en su propia base sin saberlo.',
    'Con nuestro cliente mas reciente cerramos 28 citas en 10 dias activando pacientes que hacia meses no volvian, de forma completamente automatica.',
    'Tienen algo asi implementado hoy?',
    'blog.prosites.com/improve-dental-patient-retention',
    '', '', 'PENDIENTE'
  ],
  [
    'V3', 'Paula / Setter 2', 'PLURAL',
    'Que tal, gracias por responder.',
    'Les escribiamos porque estamos ayudando a clinicas dentales a generar recurrencia sin depender constantemente de pacientes nuevos. En America Latina la mayoria de la gente solo va al dentista cuando le duele, lo que significa que casi toda base de datos tiene pacientes que necesitan volver y nadie los esta contactando.',
    'Con nuestro cliente mas reciente cerramos 28 citas en 10 dias, la mayoria nos dijo que ya tenia pendiente agendar pero nunca lo habia hecho.',
    'Es algo que les pasa en la clinica?',
    'clerri.com/blog/dental-patient-attrition-statistics',
    '', '', 'PENDIENTE'
  ],
  [
    'V4', 'Ignacio', 'SINGULAR',
    'Que tal, gracias por responder.',
    'Les escribia porque estoy ayudando a clinicas dentales a recuperar pacientes dormidos de su propia base. El 40% de los pacientes que no agenda un seguimiento nunca mas regresa, y casi ninguna clinica tiene un sistema para evitarlo.',
    'Con mi cliente mas reciente cerramos 28 citas en 10 dias de forma automatica, pacientes que hacia meses no volvian.',
    'Es algo que estan buscando resolver?',
    'mconsent.net/blog/cost-missed-follow-up-dental-practices',
    '', '', 'PENDIENTE'
  ],
  [
    'V5', 'Ignacio', 'SINGULAR',
    'Que tal, gracias por responder.',
    'Les escribia porque estoy ayudando a clinicas dentales a convertir su base de datos en pacientes que vuelven de forma recurrente. Aumentar solo un 5% la retencion puede generar hasta un 95% mas de ganancias segun Harvard Business Review, y la mayoria lo deja ir sin darse cuenta.',
    'Con mi cliente mas reciente cerramos 28 citas en 10 dias activando pacientes inactivos de forma completamente automatica.',
    'Es algo que les interesa resolver?',
    'blog.prosites.com/improve-dental-patient-retention',
    '', '', 'PENDIENTE'
  ],
];

const wsVariantes = XLSX.utils.aoa_to_sheet(variantesData);
wsVariantes['!cols'] = [
  {wch: 5}, {wch: 18}, {wch: 10}, {wch: 35}, {wch: 60}, {wch: 60}, {wch: 40}, {wch: 50}, {wch: 14}, {wch: 14}, {wch: 12}
];
XLSX.utils.book_append_sheet(wb, wsVariantes, 'VARIANTES');

// =============================================
// HOJA 2: METRICAS POR VARIANTE
// =============================================
const metricasHeader = [
  ['SCM DENTAL - METRICAS POR VARIANTE'],
  ['Llenar ENVIADOS, RESPONDIERON, CON INTERES, CALIFICADOS y AGENDARON. El resto se calcula solo.'],
  [],
  ['VAR', 'SETTER', 'FECHA INICIO', 'FECHA FIN', 'ENVIADOS', 'RESPONDIERON', '% RESPUESTA', 'CON INTERES', '% INT/RESP', '% INT/ENV', 'SIN INTERES', 'CALIFICADOS', '% CALIF/INT', 'AGENDARON', '% AGENDO/CALIF'],
];

const setterRows = [
  ['V1', 'Paula', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V1', 'Setter 2', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V2', 'Paula', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V2', 'Setter 2', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V3', 'Paula', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V3', 'Setter 2', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V4', 'Ignacio', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
  ['V5', 'Ignacio', '', '', 0, 0, null, 0, null, null, null, 0, null, 0, null],
];

const metricasData = [...metricasHeader, ...setterRows];
metricasData.push([]);

// TOTAL row
const tRow = metricasData.length + 1;
metricasData.push(['TOTAL', '', '', '', null, null, null, null, null, null, null, null, null, null, null]);

const wsMetricas = XLSX.utils.aoa_to_sheet(metricasData);

// Formulas por fila de setter (filas 5-12 en Excel)
for (let i = 0; i < setterRows.length; i++) {
  const r = i + 5;
  wsMetricas['G'+r] = {f: 'IF(E'+r+'=0,"",F'+r+'/E'+r+')', t: 'n'};
  wsMetricas['I'+r] = {f: 'IF(F'+r+'=0,"",H'+r+'/F'+r+')', t: 'n'};
  wsMetricas['J'+r] = {f: 'IF(E'+r+'=0,"",H'+r+'/E'+r+')', t: 'n'};
  wsMetricas['K'+r] = {f: 'IF(F'+r+'=0,"",F'+r+'-H'+r+')', t: 'n'};
  wsMetricas['M'+r] = {f: 'IF(H'+r+'=0,"",L'+r+'/H'+r+')', t: 'n'};
  wsMetricas['O'+r] = {f: 'IF(L'+r+'=0,"",N'+r+'/L'+r+')', t: 'n'};
}

// Formulas TOTAL
wsMetricas['E'+tRow] = {f: 'SUM(E5:E12)', t: 'n'};
wsMetricas['F'+tRow] = {f: 'SUM(F5:F12)', t: 'n'};
wsMetricas['G'+tRow] = {f: 'IF(E'+tRow+'=0,"",F'+tRow+'/E'+tRow+')', t: 'n'};
wsMetricas['H'+tRow] = {f: 'SUM(H5:H12)', t: 'n'};
wsMetricas['I'+tRow] = {f: 'IF(F'+tRow+'=0,"",H'+tRow+'/F'+tRow+')', t: 'n'};
wsMetricas['J'+tRow] = {f: 'IF(E'+tRow+'=0,"",H'+tRow+'/E'+tRow+')', t: 'n'};
wsMetricas['K'+tRow] = {f: 'SUM(K5:K12)', t: 'n'};
wsMetricas['L'+tRow] = {f: 'SUM(L5:L12)', t: 'n'};
wsMetricas['M'+tRow] = {f: 'IF(H'+tRow+'=0,"",L'+tRow+'/H'+tRow+')', t: 'n'};
wsMetricas['N'+tRow] = {f: 'SUM(N5:N12)', t: 'n'};
wsMetricas['O'+tRow] = {f: 'IF(L'+tRow+'=0,"",N'+tRow+'/L'+tRow+')', t: 'n'};

wsMetricas['!cols'] = [
  {wch: 6}, {wch: 12}, {wch: 14}, {wch: 14}, {wch: 10}, {wch: 14}, {wch: 12}, {wch: 13}, {wch: 12}, {wch: 12}, {wch: 12}, {wch: 13}, {wch: 13}, {wch: 12}, {wch: 15}
];
XLSX.utils.book_append_sheet(wb, wsMetricas, 'METRICAS');

// =============================================
// HOJA 3: RANKING
// =============================================
const rankData = [
  ['SCM DENTAL - RANKING DE VARIANTES'],
  ['Ordenar manualmente por % interes/resp despues de cada ciclo. La que gana se itera.'],
  [],
  ['POS', 'VARIANTE', 'SETTER', 'TOTAL ENV', 'TOTAL RESP', '% RESP', 'TOTAL INTERES', '% INT/RESP', '% INT/ENV', 'AGENDARON', '% CONVERSION', 'VEREDICTO'],
  [1, 'V1', '', 0, 0, null, 0, null, null, 0, null, 'EN PRUEBA'],
  [2, 'V2', '', 0, 0, null, 0, null, null, 0, null, 'EN PRUEBA'],
  [3, 'V3', '', 0, 0, null, 0, null, null, 0, null, 'EN PRUEBA'],
  [4, 'V4', '', 0, 0, null, 0, null, null, 0, null, 'EN PRUEBA'],
  [5, 'V5', '', 0, 0, null, 0, null, null, 0, null, 'EN PRUEBA'],
  [],
  ['CRITERIOS DE VEREDICTO:'],
  ['GANADORA = Mayor % interes despues de 2+ ciclos'],
  ['PROMETEDORA = Buen % pero pocos datos todavia'],
  ['DESCARTADA = <10% interes despues de 2 ciclos (6 dias)'],
  ['EN PRUEBA = Aun en periodo de testeo'],
  [],
  ['SIGUIENTE PASO: Tomar la GANADORA, cambiar 1 solo elemento (msg2 o msg3) y crear V6, V7, etc.'],
];

const wsRanking = XLSX.utils.aoa_to_sheet(rankData);
for (let i = 1; i <= 5; i++) {
  const r = i + 4;
  wsRanking['F'+r] = {f: 'IF(D'+r+'=0,"",E'+r+'/D'+r+')', t: 'n'};
  wsRanking['H'+r] = {f: 'IF(E'+r+'=0,"",G'+r+'/E'+r+')', t: 'n'};
  wsRanking['I'+r] = {f: 'IF(D'+r+'=0,"",G'+r+'/D'+r+')', t: 'n'};
  wsRanking['K'+r] = {f: 'IF(D'+r+'=0,"",J'+r+'/D'+r+')', t: 'n'};
}
wsRanking['!cols'] = [
  {wch: 5}, {wch: 10}, {wch: 14}, {wch: 10}, {wch: 12}, {wch: 10}, {wch: 14}, {wch: 12}, {wch: 12}, {wch: 12}, {wch: 14}, {wch: 16}
];
XLSX.utils.book_append_sheet(wb, wsRanking, 'RANKING');

// =============================================
// HOJA 4: HISTORIAL DE CICLOS
// =============================================
const histData = [
  ['SCM DENTAL - HISTORIAL DE CICLOS DE TESTEO'],
  ['Registrar cada ciclo cuando termina. Permite ver evolucion y aprendizajes.'],
  [],
  ['CICLO', 'FECHA INICIO', 'FECHA FIN', 'VARIANTE', 'SETTER', 'ENVIADOS', 'RESPONDIERON', '% RESP', 'CON INTERES', '% INTERES', 'AGENDARON', 'APRENDIZAJE / NOTAS'],
  ['C1', '', '', 'V1', 'Paula', 0, 0, null, 0, null, 0, ''],
  ['C1', '', '', 'V1', 'Setter 2', 0, 0, null, 0, null, 0, ''],
  ['C1', '', '', 'V4', 'Ignacio', 0, 0, null, 0, null, 0, ''],
  [],
  ['C2', '', '', 'V2', 'Paula', 0, 0, null, 0, null, 0, ''],
  ['C2', '', '', 'V2', 'Setter 2', 0, 0, null, 0, null, 0, ''],
  ['C2', '', '', 'V5', 'Ignacio', 0, 0, null, 0, null, 0, ''],
  [],
  ['C3', '', '', 'V3', 'Paula', 0, 0, null, 0, null, 0, ''],
  ['C3', '', '', 'V3', 'Setter 2', 0, 0, null, 0, null, 0, ''],
  ['C3', '', '', '', 'Ignacio', 0, 0, null, 0, null, 0, '(iterar sobre ganadora V4 o V5)'],
];

const wsHistorial = XLSX.utils.aoa_to_sheet(histData);

// Formulas para todas las filas con data (5-7, 9-11, 13-15)
const histRows = [5,6,7,9,10,11,13,14,15];
histRows.forEach(r => {
  wsHistorial['H'+r] = {f: 'IF(F'+r+'=0,"",G'+r+'/F'+r+')', t: 'n'};
  wsHistorial['J'+r] = {f: 'IF(G'+r+'=0,"",I'+r+'/G'+r+')', t: 'n'};
});

wsHistorial['!cols'] = [
  {wch: 7}, {wch: 14}, {wch: 14}, {wch: 10}, {wch: 12}, {wch: 10}, {wch: 14}, {wch: 10}, {wch: 13}, {wch: 12}, {wch: 12}, {wch: 50}
];
XLSX.utils.book_append_sheet(wb, wsHistorial, 'HISTORIAL CICLOS');

// =============================================
// GUARDAR
// =============================================
const outputPath = 'C:/Users/Usuario/OneDrive/Desktop/SCM_VARIANTES_CONTROL_v2.xlsx';
XLSX.writeFile(wb, outputPath);
console.log('Archivo creado en:', outputPath);
