package io.restaurantos.shared.integration;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface WidgetRepository extends JpaRepository<Widget, UUID> {}
