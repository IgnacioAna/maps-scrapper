// Base de datos de ciudades principales por país (Latinoamérica + España)
const LOCATIONS_DB = {
  "Argentina": [
    "Buenos Aires", "Córdoba", "Rosario", "Mendoza", "San Miguel de Tucumán",
    "La Plata", "Mar del Plata", "Salta", "Santa Fe", "San Juan",
    "Resistencia", "Corrientes", "Posadas", "Neuquén", "Formosa",
    "San Luis", "Santiago del Estero", "Río Gallegos", "Ushuaia",
    "Bahía Blanca", "Paraná", "San Rafael", "Tandil", "Pergamino",
    "Villa María", "Rafaela", "Concordia", "Gualeguaychú",
    "San Carlos de Bariloche", "Puerto Madryn", "Comodoro Rivadavia",
    "Santa Rosa La Pampa", "Rawson", "Catamarca", "La Rioja", "Jujuy"
  ],
  "Chile": [
    "Santiago", "Valparaíso", "Concepción", "La Serena", "Antofagasta",
    "Temuco", "Rancagua", "Talca", "Arica", "Iquique",
    "Puerto Montt", "Chillán", "Osorno", "Valdivia", "Coyhaique",
    "Punta Arenas", "Copiapó", "Los Ángeles", "Curicó", "Linares",
    "Quilpué", "Viña del Mar", "San Bernardo", "Puente Alto", "Maipú"
  ],
  "Uruguay": [
    "Montevideo", "Salto", "Paysandú", "Las Piedras", "Rivera",
    "Maldonado", "Tacuarembó", "Melo", "Mercedes", "Artigas",
    "Minas", "San José de Mayo", "Durazno", "Florida", "Treinta y Tres",
    "Rocha", "Colonia del Sacramento", "Fray Bentos", "Trinidad",
    "Canelones", "Punta del Este", "Ciudad de la Costa"
  ],
  "Colombia": [
    "Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena",
    "Cúcuta", "Bucaramanga", "Pereira", "Santa Marta", "Ibagué",
    "Pasto", "Manizales", "Neiva", "Villavicencio", "Armenia",
    "Valledupar", "Montería", "Sincelejo", "Popayán", "Tunja",
    "Riohacha", "Quibdó", "Florencia", "Mocoa"
  ],
  "México": [
    "Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Tijuana",
    "León", "Juárez", "Zapopan", "Mérida", "San Luis Potosí",
    "Aguascalientes", "Hermosillo", "Saltillo", "Mexicali", "Culiacán",
    "Querétaro", "Morelia", "Chihuahua", "Cancún", "Acapulco",
    "Toluca", "Veracruz", "Villahermosa", "Tuxtla Gutiérrez",
    "Oaxaca", "Durango", "Tampico", "Mazatlán", "Playa del Carmen",
    "Cuernavaca", "Pachuca", "Xalapa", "Campeche", "Colima"
  ],
  "Perú": [
    "Lima", "Arequipa", "Trujillo", "Chiclayo", "Piura",
    "Iquitos", "Cusco", "Huancayo", "Chimbote", "Tacna",
    "Pucallpa", "Juliaca", "Ayacucho", "Cajamarca", "Puno",
    "Ica", "Huánuco", "Sullana", "Tarapoto", "Tumbes"
  ],
  "Ecuador": [
    "Quito", "Guayaquil", "Cuenca", "Santo Domingo", "Machala",
    "Ambato", "Portoviejo", "Manta", "Riobamba", "Loja",
    "Ibarra", "Esmeraldas", "Latacunga", "Tulcán", "Babahoyo",
    "Quevedo", "Milagro", "Durán"
  ],
  "Paraguay": [
    "Asunción", "Ciudad del Este", "San Lorenzo", "Luque", "Capiatá",
    "Lambaré", "Fernando de la Mora", "Encarnación", "Pedro Juan Caballero",
    "Villarrica", "Caaguazú", "Coronel Oviedo", "Concepción",
    "Pilar", "Areguá", "Caacupé", "Itauguá"
  ],
  "Bolivia": [
    "La Paz", "Santa Cruz de la Sierra", "Cochabamba", "Sucre",
    "Oruro", "Tarija", "Potosí", "Trinidad", "Cobija"
  ],
  "Venezuela": [
    "Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay",
    "Ciudad Guayana", "Barcelona", "Maturín", "Puerto La Cruz",
    "San Cristóbal", "Mérida", "Barinas", "Cumaná", "Punto Fijo"
  ],
  "Costa Rica": [
    "San José", "Alajuela", "Cartago", "Heredia", "Liberia",
    "Puntarenas", "Limón", "San Isidro", "Nicoya", "Turrialba"
  ],
  "Panamá": [
    "Ciudad de Panamá", "San Miguelito", "David", "Colón", "La Chorrera",
    "Santiago", "Chitré", "Penonomé", "Aguadulce", "Bocas del Toro"
  ],
  "República Dominicana": [
    "Santo Domingo", "Santiago de los Caballeros", "La Romana",
    "San Pedro de Macorís", "San Francisco de Macorís", "Puerto Plata",
    "Higüey", "La Vega", "Barahona", "Bonao", "Punta Cana"
  ],
  "España": [
    "Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza",
    "Málaga", "Murcia", "Palma de Mallorca", "Las Palmas", "Bilbao",
    "Alicante", "Córdoba", "Valladolid", "Vigo", "Gijón",
    "Granada", "A Coruña", "Vitoria", "Santa Cruz de Tenerife",
    "Pamplona", "Santander", "San Sebastián", "Salamanca", "Burgos",
    "Albacete", "Logroño", "Badajoz", "Huelva", "Tarragona",
    "León", "Cádiz", "Jaén", "Ourense", "Girona", "Lugo"
  ],
  "Estados Unidos": [
    "New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
    "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose",
    "Austin", "Jacksonville", "San Francisco", "Miami", "Seattle",
    "Denver", "Washington DC", "Nashville", "Boston", "Las Vegas",
    "Portland", "Memphis", "Louisville", "Baltimore", "Milwaukee",
    "Albuquerque", "Tucson", "Fresno", "Sacramento", "Atlanta",
    "Orlando", "Tampa", "Charlotte", "Minneapolis", "Detroit"
  ],
  "Brasil": [
    "São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza",
    "Belo Horizonte", "Manaus", "Curitiba", "Recife", "Porto Alegre",
    "Belém", "Goiânia", "Guarulhos", "Campinas", "São Luís",
    "Maceió", "Florianópolis", "Natal", "Campo Grande", "Vitória",
    "Teresina", "São Bernardo do Campo", "João Pessoa", "Santo André", "Osasco",
    "Ribeirão Preto", "Uberlândia", "Sorocaba", "Cuiabá", "Aracaju"
  ],
  "Canadá": [
    "Toronto", "Montréal", "Vancouver", "Calgary", "Edmonton",
    "Ottawa", "Winnipeg", "Québec", "Hamilton", "Kitchener",
    "London", "Victoria", "Halifax", "Oshawa", "Windsor",
    "Saskatoon", "Regina", "Mississauga", "Brampton", "Surrey",
    "Laval", "Gatineau", "Burnaby", "Markham", "Richmond"
  ],
  "Reino Unido": [
    "London", "Birmingham", "Manchester", "Glasgow", "Liverpool",
    "Leeds", "Sheffield", "Edinburgh", "Bristol", "Cardiff",
    "Leicester", "Coventry", "Nottingham", "Newcastle", "Belfast",
    "Brighton", "Southampton", "Portsmouth", "Reading", "Aberdeen",
    "Plymouth", "Derby", "Wolverhampton", "Swansea", "Milton Keynes"
  ],
  "Alemania": [
    "Berlin", "Hamburg", "München", "Köln", "Frankfurt",
    "Stuttgart", "Düsseldorf", "Leipzig", "Dortmund", "Essen",
    "Bremen", "Dresden", "Hannover", "Nürnberg", "Duisburg",
    "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Münster",
    "Karlsruhe", "Mannheim", "Augsburg", "Wiesbaden", "Mönchengladbach"
  ],
  "Francia": [
    "Paris", "Marseille", "Lyon", "Toulouse", "Nice",
    "Nantes", "Montpellier", "Strasbourg", "Bordeaux", "Lille",
    "Rennes", "Reims", "Saint-Étienne", "Toulon", "Le Havre",
    "Grenoble", "Dijon", "Angers", "Nîmes", "Villeurbanne",
    "Clermont-Ferrand", "Aix-en-Provence", "Brest", "Tours", "Amiens"
  ],
  "Italia": [
    "Roma", "Milano", "Napoli", "Torino", "Palermo",
    "Genova", "Bologna", "Firenze", "Bari", "Catania",
    "Venezia", "Verona", "Messina", "Padova", "Trieste",
    "Brescia", "Parma", "Taranto", "Prato", "Modena",
    "Reggio Calabria", "Reggio Emilia", "Perugia", "Livorno", "Cagliari"
  ]
};

export default LOCATIONS_DB;
