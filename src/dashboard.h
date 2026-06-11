#pragma once

#include <Arduino.h>

void dashboardInit();
void dashboardLogEvent(const String &, bool);

String dashboardGetJson();