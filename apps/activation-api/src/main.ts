import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { TOPICS } from '@poc/contracts';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = process.env.PORT ?? 3000;
  const groupId = config.getOrThrow<string>('KAFKA_GROUP_ID');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
        brokers: [config.getOrThrow<string>('KAFKA_BROKERS')],
      },
      consumer: {
        groupId,
      },
      // Un consumer group nuevo arranca desde el inicio del topic. Evita perder
      // el primer evento si se publica antes de que el grupo termine de unirse.
      subscribe: { fromBeginning: true },
      postfixId: '', // Evita que Nest agregue "-server"
    },
  });

  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // init() termina de inicializar módulos (Mongo) y después arrancan los microservicios
  await app.init();
  await app.startAllMicroservices();
  await app.listen(port);

  Logger.log(
    `activation-api escuchando HTTP en :${port} y Kafka como "${groupId}" (${TOPICS.billingEvents}, ${TOPICS.provisioningEvents})`,
    'Bootstrap',
  );
}
void bootstrap();
