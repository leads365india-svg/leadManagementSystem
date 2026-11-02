/**
 * Leads365 Admin Settings JavaScript
 */
(function ($) {
    'use strict';

    $(document).ready(function () {
        var $testBtn = $('#leads365-test-btn');
        var $resultBox = $('#leads365-test-result');

        if (!$testBtn.length) {
            return;
        }

        $testBtn.on('click', function (e) {
            e.preventDefault();

            $testBtn.prop('disabled', true).addClass('leads365-loading');
            $resultBox.hide().removeClass('leads365-success leads365-error').html('<p>' + leads365_admin.strings.testing + '</p>').slideDown(200);

            $.ajax({
                url: leads365_admin.ajax_url,
                type: 'POST',
                dataType: 'json',
                data: {
                    action: 'leads365_test_connection',
                    security: leads365_admin.nonce
                },
                success: function (res) {
                    $testBtn.prop('disabled', false).removeClass('leads365-loading');
                    if (res && res.success) {
                        $resultBox.addClass('leads365-success').html('<strong>' + leads365_admin.strings.success + '</strong><br>' + (res.data ? res.data.message : ''));
                    } else {
                        var msg = (res && res.data && res.data.message) ? res.data.message : leads365_admin.strings.failed;
                        $resultBox.addClass('leads365-error').html('<strong>' + leads365_admin.strings.failed + '</strong><br>' + msg);
                    }
                },
                error: function (xhr, status, error) {
                    $testBtn.prop('disabled', false).removeClass('leads365-loading');
                    $resultBox.addClass('leads365-error').html('<strong>' + leads365_admin.strings.failed + '</strong><br>HTTP ' + xhr.status + ': ' + error);
                }
            });
        });
    });
})(jQuery);
