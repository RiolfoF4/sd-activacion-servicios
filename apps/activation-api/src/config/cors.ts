// Orígenes permitidos para el navegador de la demo.
//
// El puerto 5173 lo usan tanto el server de Vite (desarrollo local) como el
// servicio demo-ui de Docker Compose (incremento 5).
//
// Ojo con el momento de evaluación: el decorador de @WebSocketGateway se
// resuelve al importar el módulo, ANTES de que ConfigModule cargue el .env.
// Por eso esta lista es una constante y no una variable de entorno. Si algún
// día hay que configurarla, la vía es un IoAdapter propio que lea el
// ConfigService en el arranque.
export const CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
