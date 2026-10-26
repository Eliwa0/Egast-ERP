import unittest

from scale_agent.parser import parse_weight, SerialParser, is_valid_scale_line


class TestParseWeight(unittest.TestCase):

    def test_plain_number(self):
        self.assertEqual(parse_weight("1250.40"), 1250.40)

    def test_integer(self):
        self.assertEqual(parse_weight("12500"), 12500.0)

    def test_kg_suffix(self):
        self.assertEqual(parse_weight("1250.40 kg"), 1250.40)

    def test_scale_protocol_format(self):
        self.assertEqual(parse_weight("ST,GS,+012540.00kg"), 12540.00)

    def test_scale_protocol_zero_with_spaces(self):
        self.assertEqual(parse_weight("ST,GS,+      0kg"), 0.0)

    def test_scale_protocol_nonzero_with_spaces(self):
        self.assertEqual(parse_weight("ST,GS,+      5kg"), 5.0)

    def test_plus_sign_zero_padded(self):
        self.assertEqual(parse_weight("+001250.40"), 1250.40)

    def test_negative(self):
        self.assertEqual(parse_weight("-1250.40"), -1250.40)

    def test_labeled(self):
        self.assertEqual(parse_weight("WN: 5420.0 kg"), 5420.0)

    def test_empty(self):
        self.assertIsNone(parse_weight(""))

    def test_none(self):
        self.assertIsNone(parse_weight(None))

    def test_no_number(self):
        self.assertIsNone(parse_weight("NO_DATA"))

    def test_garbage_text(self):
        self.assertIsNone(parse_weight("ERROR"))

    def test_arbitrary_printable_text_with_number_rejected(self):
        self.assertIsNone(parse_weight("status code 12 ready"))

    def test_not_a_string(self):
        self.assertIsNone(parse_weight(1234))


class TestIsValidScaleLine(unittest.TestCase):

    def test_valid(self):
        self.assertTrue(is_valid_scale_line("1250.40 kg"))

    def test_valid_confirmed_scale_protocol(self):
        self.assertTrue(is_valid_scale_line("ST,GS,+      0kg"))

    def test_invalid(self):
        self.assertFalse(is_valid_scale_line("NO_DATA"))

    def test_invalid_arbitrary_number_text(self):
        self.assertFalse(is_valid_scale_line("status code 12 ready"))

    def test_empty(self):
        self.assertFalse(is_valid_scale_line(""))


class TestSerialParser(unittest.TestCase):

    def test_default_parser(self):
        parser = SerialParser()
        self.assertEqual(parser.parse("1250.40 kg"), 1250.40)

    def test_custom_parser_registration(self):
        parser = SerialParser()

        def custom_parse(line):
            if line.startswith("WT:"):
                return float(line[3:].strip())
            return None

        parser.add_parser(custom_parse)
        self.assertEqual(parser.parse("WT:42"), 42.0)

    def test_first_parser_wins(self):
        parser = SerialParser()
        parser.add_parser(lambda line: 99.0)
        self.assertEqual(parser.parse("1250.40 kg"), 1250.40)

    def test_negative_rejected(self):
        parser = SerialParser()
        self.assertIsNone(parser.parse("-000000.00"))

    def test_zero_accepted(self):
        parser = SerialParser()
        self.assertEqual(parser.parse("ST,GS,+      0kg"), 0.0)


if __name__ == "__main__":
    unittest.main()
