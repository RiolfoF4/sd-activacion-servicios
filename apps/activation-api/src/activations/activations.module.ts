import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivationsGateway } from './activations.gateway';
import { ActivationsPublisher } from './activations.publisher';
import { Activation, ActivationSchema } from './activations.schema';
import { ActivationsService } from './activations.service';
import { ActivationsController } from './activations.controller';
import { ActivationsConsumer } from './activations.consumer';
import { KafkaProducerModule } from './kafka/kafka-producer.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Activation.name, schema: ActivationSchema },
    ]),
    KafkaProducerModule,
  ],
  controllers: [ActivationsController, ActivationsConsumer],
  providers: [ActivationsService, ActivationsGateway, ActivationsPublisher],
})
export class ActivationsModule {}
