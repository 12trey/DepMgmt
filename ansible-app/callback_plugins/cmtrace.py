# callback_plugins/cmtrace.py

from __future__ import (absolute_import, division, print_function)
__metaclass__ = type

import datetime
import socket
from ansible.plugins.callback import CallbackBase

DOCUMENTATION = '''
    callback: cmtrace
    type: notification
    short_description: CMTrace-compatible logging
    description:
        - Logs Ansible output in CMTrace log format
'''

class CallbackModule(CallbackBase):

    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'notification'
    CALLBACK_NAME = 'cmtrace'

    def __init__(self):
        super(CallbackModule, self).__init__()
        self.log_file = "/tmp/ansible_cmtrace.log"
        self.component = "Ansible"
        self.hostname = socket.gethostname()

    def _get_time(self):
        now = datetime.datetime.utcnow()
        time_str = now.strftime("%H:%M:%S.%f")[:-3] + "+000"
        date_str = now.strftime("%m-%d-%Y")
        return time_str, date_str

    def _write_log(self, message, log_type="1"):
        time_str, date_str = self._get_time()

        line = (
            f'<![LOG[{message}]LOG]!>'
            f'<time="{time_str}" '
            f'date="{date_str}" '
            f'component="{self.component}" '
            f'context="{self.hostname}" '
            f'type="{log_type}" '
            f'thread="" '
            f'file="">\n'
        )

        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(line)

    # --- Playbook lifecycle ---
    def v2_playbook_on_start(self, playbook):
        self._write_log(f"Playbook started: {playbook._file_name}", "1")

    def v2_playbook_on_stats(self, stats):
        summary = []
        for host in stats.processed:
            s = stats.summarize(host)
            summary.append(f"{host} OK={s['ok']} CHANGED={s['changed']} FAILED={s['failures']}")
        self._write_log("Playbook complete: " + " | ".join(summary), "1")

    # --- Play ---
    def v2_playbook_on_play_start(self, play):
        self._write_log(f"Starting play: {play.get_name()}", "1")

    # --- Tasks ---
    def v2_playbook_on_task_start(self, task, is_conditional):
        self._write_log(f"Task started: {task.get_name()}", "1")

    def v2_runner_on_ok(self, result):
        host = result._host.get_name()
        task = result.task_name
        changed = result._result.get("changed", False)

        msg = f"{host} | SUCCESS | {task}"
        if changed:
            msg += " (changed)"

        self._write_log(msg, "1")

    def v2_runner_on_failed(self, result, ignore_errors=False):
        host = result._host.get_name()
        task = result.task_name
        error = result._result.get("msg", "Task failed")

        msg = f"{host} | FAILED | {task} | {error}"
        self._write_log(msg, "3")

    def v2_runner_on_skipped(self, result):
        host = result._host.get_name()
        task = result.task_name

        msg = f"{host} | SKIPPED | {task}"
        self._write_log(msg, "2")

    def v2_runner_on_unreachable(self, result):
        host = result._host.get_name()
        error = result._result.get("msg", "Unreachable")

        msg = f"{host} | UNREACHABLE | {error}"
        self._write_log(msg, "3")

    # --- Handlers ---
    def v2_playbook_on_handler_task_start(self, task):
        self._write_log(f"Handler started: {task.get_name()}", "1")