import {
  DynamicModule,
  Global,
  Inject,
  Module,
  Provider,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as mongoose from 'mongoose';
import { defer } from 'rxjs';
import { getConnectionToken, handleRetry } from './common/mongoose.utils';
import {
  MongooseModuleAsyncOptions,
  MongooseModuleOptions,
  MongooseOptionsFactory,
} from './interfaces/mongoose-options.interface';
import {
  MONGOOSE_CONNECTION_NAME,
  MONGOOSE_MODULE_OPTIONS,
} from './mongoose.constants';

@Global()
@Module({})
export class MongooseCoreModule {
  constructor(
    @Inject(MONGOOSE_CONNECTION_NAME) private readonly connectionName: string,
    private readonly moduleRef: ModuleRef,
  ) {}

  static forRoot(
    uri: string,
    options: MongooseModuleOptions = {},
  ): DynamicModule {
    const {
      retryAttempts,
      retryDelay,
      connectionName,
      ...mongooseOptions
    } = options;

    const mongooseConnectionName = getConnectionToken(connectionName);

    const mongooseConnectionNameProvider = {
      provide: MONGOOSE_CONNECTION_NAME,
      useValue: mongooseConnectionName,
    };
    const connectionProvider = {
      provide: mongooseConnectionName,
      useFactory: async (): Promise<any> =>
        await defer(async () =>
          mongoose.createConnection(uri, mongooseOptions as any),
        )
          .pipe(handleRetry(retryAttempts, retryDelay))
          .toPromise(),
    };
    return {
      module: MongooseCoreModule,
      providers: [connectionProvider, mongooseConnectionNameProvider],
      exports: [connectionProvider],
    };
  }

  static forRootAsync(options: MongooseModuleAsyncOptions): DynamicModule {
    const mongooseConnectionName = getConnectionToken(options.connectionName);

    const mongooseConnectionNameProvider = {
      provide: MONGOOSE_CONNECTION_NAME,
      useValue: mongooseConnectionName,
    };

    const connectionProvider = {
      provide: mongooseConnectionName,
      useFactory: async (
        mongooseModuleOptions: MongooseModuleOptions,
      ): Promise<any> => {
        const {
          retryAttempts,
          retryDelay,
          connectionName,
          uri,
          ...mongooseOptions
        } = mongooseModuleOptions;

        return await defer(async () =>
          mongoose.createConnection(
            mongooseModuleOptions.uri,
            mongooseOptions as any,
          ),
        )
          .pipe(
            handleRetry(
              mongooseModuleOptions.retryAttempts,
              mongooseModuleOptions.retryDelay,
            ),
          )
          .toPromise();
      },
      inject: [MONGOOSE_MODULE_OPTIONS],
    };
    const asyncProviders = this.createAsyncProviders(options);
    return {
      module: MongooseCoreModule,
      imports: options.imports,
      providers: [
        ...asyncProviders,
        connectionProvider,
        mongooseConnectionNameProvider,
      ],
      exports: [connectionProvider],
    };
  }

  async onModuleDestroy() {
    const connection = this.moduleRef.get<any>(this.connectionName);
    connection && (await connection.close());
  }

  private static createAsyncProviders(
    options: MongooseModuleAsyncOptions,
  ): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }
    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: options.useClass,
        useClass: options.useClass,
      },
    ];
  }

  private static createAsyncOptionsProvider(
    options: MongooseModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: MONGOOSE_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }
    return {
      provide: MONGOOSE_MODULE_OPTIONS,
      useFactory: async (optionsFactory: MongooseOptionsFactory) =>
        await optionsFactory.createMongooseOptions(),
      inject: [options.useExisting || options.useClass],
    };
  }
}
