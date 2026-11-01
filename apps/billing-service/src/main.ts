import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
        brokers: [config.getOrThrow<string>('KAFKA_BROKERS')],
      },
      consumer: {
        groupId: config.getOrThrow<string>('KAFKA_GROUP_ID'),
      },
      // Un consumer group nuevo arranca desde el inicio del topic. Evita perder
      // el primer evento si se publica antes de que el grupo termine de unirse.
      subscribe: { fromBeginning: true },
      postfixId: '', // Evita que Nest agrege "-server"
    },
  });

  app.enableShutdownHooks();

  // init() termina de inicializar módulos (Mongo) y después arrancan los microservicios
  // No se llama listen() porque el servicio no expone HTTP
  await app.init();
  await app.startAllMicroservices();

  Logger.log(
    `billing-service escuchando "${config.getOrThrow<string>('KAFKA_GROUP_ID')}"`,
    'Bootstrap',
  );
}
void bootstrap();
