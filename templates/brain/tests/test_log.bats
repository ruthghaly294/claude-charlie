#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  source "$ROOT/lib/log.sh"
}

@test "log_ok prints checkmark prefix" {
  result="$(log_ok 'all good')"
  [[ "$result" == *"✓"* ]]
  [[ "$result" == *"all good"* ]]
}

@test "log_warn prints warning prefix" {
  result="$(log_warn 'careful')"
  [[ "$result" == *"!"* ]]
  [[ "$result" == *"careful"* ]]
}

@test "log_fail prints x prefix" {
  result="$(log_fail 'broken' 2>&1)"
  [[ "$result" == *"✗"* ]]
  [[ "$result" == *"broken"* ]]
}

@test "log_die exits 1 after logging" {
  run bash -c "source $ROOT/lib/log.sh; log_die 'fatal'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"fatal"* ]]
}

@test "log_step prints headline" {
  result="$(log_step 'Starting')"
  [[ "$result" == *"Starting"* ]]
}
