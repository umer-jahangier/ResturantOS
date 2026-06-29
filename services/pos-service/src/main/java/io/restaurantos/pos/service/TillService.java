package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillSessionDto;

import java.util.List;
import java.util.UUID;

public interface TillService {

    TillSessionDto openTill(OpenTillRequest request);

    TillSessionDto closeTill(UUID tillId, CloseTillRequest request);

    TillSessionDto getTill(UUID tillId);

    List<TillSessionDto> listTills(UUID cashierId, String status);
}
