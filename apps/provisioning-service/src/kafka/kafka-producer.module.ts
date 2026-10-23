import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

export const PROVISIONING_KAFKA_CLIENT = 'PROVISIONING_SERVICE';

// Productor propio del servicio
// Es una conexión aparte de la del consumidor así el groupId del
// consumer no se mezcla con el clientId del producer
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        imports: [ConfigModule],
        name: PROVISIONING_KAFKA_CLIENT,
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
              brokers: [config.getOrThrow<string>('KAFKA_BROKERS')],
            },
            producerOnlyMode: true,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class KafkaProducerModule {}
