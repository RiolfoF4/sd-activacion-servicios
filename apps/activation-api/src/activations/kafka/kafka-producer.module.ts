import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

export const KAFKA_CLIENT = 'ACTIVATION_API';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        imports: [ConfigModule],
        name: KAFKA_CLIENT,
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
