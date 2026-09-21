import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let response: { status: jest.Mock; json: jest.Mock };

  const hostFor = () =>
    ({
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/v1/auth/login' }),
      }),
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    response = {
      status: jest.fn(function (this: unknown) {
        return response;
      }),
      json: jest.fn(),
    };
  });

  it('keeps the status and message of a nest exception', () => {
    filter.catch(new NotFoundException('nothing here'), hostFor());

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'nothing here',
      }),
    );
  });

  it('honours the status carried by a body parser error', () => {
    const payloadTooLarge = Object.assign(
      new Error('request entity too large'),
      {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      },
    );

    filter.catch(payloadTooLarge, hostFor());

    expect(response.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: 'request entity too large',
      }),
    );
  });

  it('reports malformed json as a client error', () => {
    const malformed = Object.assign(new Error('Unexpected token in JSON'), {
      statusCode: HttpStatus.BAD_REQUEST,
    });

    filter.catch(malformed, hostFor());

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unexpected token in JSON' }),
    );
  });

  it('never leaks the message of an unexpected failure', () => {
    filter.catch(new Error('connection string leaked here'), hostFor());

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
  });

  it('ignores an out of range status', () => {
    filter.catch(Object.assign(new Error('weird'), { status: 42 }), hostFor());

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});
